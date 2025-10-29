<?php
// exit_officer_dashboard.php
session_start();
error_reporting(E_ALL);
ini_set('display_errors', 1);

try {
    include_once 'db.php'; // must set $pdo (PDO)
} catch (Exception $e) {
    die("db.php include failed: " . $e->getMessage());
}

if (empty($_SESSION['user_id']) || ($_SESSION['role'] ?? '') !== 'exit_officer') {
    http_response_code(403);
    echo "<h3>Access denied. Log in as exit_officer.</h3>";
    exit;
}

function h($s){ return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/* ================= Helpers ================= */

function highlight_match($text, $search) {
    if (empty($search) || $search === '') return h($text);
    $pattern = '/' . preg_quote($search, '/') . '/i';
    return preg_replace_callback($pattern, function($m){ return '<mark class="vehicle-highlight">'.h($m[0]).'</mark>'; }, h($text));
}

function normalize_list_from_string($s) {
    if ($s === null || $s === '') return [];
    $clean = str_replace(["\r\n","\r","\t"], ["\n","\n"," "], $s);
    $parts = preg_split('/[,\;\|\n]+/', $clean, -1, PREG_SPLIT_NO_EMPTY);
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p);
        $p = preg_replace('/^[\s"\'\(\)\.\-]+|[\s"\'\(\)\.\-]+$/u', '', $p);
        if ($p === '') continue;
        $p = preg_replace('/\s+/u', ' ', $p);
        $out[] = $p;
    }
    $seen = [];
    $uniq = [];
    foreach ($out as $v) {
        $key = mb_strtoupper($v);
        if (!isset($seen[$key])) { $seen[$key] = true; $uniq[] = $v; }
    }
    return $uniq;
}

function normalize_vehicle_token(string $s): string {
    $raw = preg_replace('/[^A-Za-z0-9]+/u', '', (string)$s);
    return mb_strtoupper($raw);
}

function get_control_room($pdo, $container_no) {
    $q = "SELECT id, scan_date, scan_start_time, scan_end_time, scan_station, exit_status, container_number
          FROM control_room
          WHERE TRIM(container_number) = TRIM(:c)
          ORDER BY id DESC
          LIMIT 1";
    $s = $pdo->prepare($q);
    $s->execute([':c' => $container_no]);
    return $s->fetch(PDO::FETCH_ASSOC) ?: null;
}

function is_exited($pdo, $container_no) {
    $q = "SELECT 1 FROM outgate_logs WHERE TRIM(container_number) = TRIM(:c) AND new_status = 'exited' LIMIT 1";
    $s = $pdo->prepare($q);
    $s->execute([':c' => $container_no]);
    return (bool)$s->fetch();
}

function get_container_payment_and_payment_info($pdo, $container_no) {
    $q = "SELECT c.payment_id, p.receipt_no, p.consignee_name, c.container_size
          FROM containers c
          LEFT JOIN payments p ON p.id = c.payment_id
          WHERE TRIM(c.container_no) = TRIM(:c)
          LIMIT 1";
    $s = $pdo->prepare($q);
    $s->execute([':c' => $container_no]);
    return $s->fetch(PDO::FETCH_ASSOC) ?: ['payment_id' => null, 'receipt_no' => null, 'consignee_name' => null, 'container_size' => null];
}

function make_modal_id($appointment_id, $container_no) {
    return 'view_' . intval($appointment_id) . '_' . substr(md5($container_no), 0, 10);
}

/* Helper: check datetime in range (modal filter used server-side earlier) */
function in_datetime_range($date_time_str, $date_from, $date_to, $time_from, $time_to) {
    if (empty($date_from) && empty($date_to) && empty($time_from) && empty($time_to)) return true;
    if (empty($date_time_str)) return false;
    try {
        $dt = new DateTime($date_time_str);
    } catch (Exception $e) {
        return false;
    }
    $start = null; $end = null;
    if (!empty($date_from)) {
        $start_time = $time_from ?: '00:00:00';
        $start = DateTime::createFromFormat('Y-m-d H:i:s', $date_from . ' ' . $start_time);
    }
    if (!empty($date_to)) {
        $end_time = $time_to ?: '23:59:59';
        $end = DateTime::createFromFormat('Y-m-d H:i:s', $date_to . ' ' . $end_time);
    }
    if ($start && $dt < $start) return false;
    if ($end && $dt > $end) return false;
    return true;
}

/* ================= AJAX: fetch modal records (lazy load with pagination) =================
   Returns JSON:
     { items: [...], total: N, page: p, per_page: m, total_pages: t }
   Merges outgate_logs (exited) and vehicle_details (exit_status='exited') into a single list.
*/
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'fetch_modal_records') {
    header('Content-Type: application/json; charset=utf-8');

    if (empty($_SESSION['user_id']) || ($_SESSION['role'] ?? '') !== 'exit_officer') {
        http_response_code(403);
        echo json_encode(['error' => 'Access denied']);
        exit;
    }

    $page = max(1, (int)($_GET['page'] ?? 1));
    $per_page = (int)($_GET['per_page'] ?? 100); // default per page
    if ($per_page <= 0 || $per_page > 1000) $per_page = 100;

    $offset = ($page - 1) * $per_page;

    // Optional: accept vehicle_no / container_no filters to narrow server result
    $filter_vehicle = trim($_GET['vehicle_no'] ?? '');
    $filter_container = trim($_GET['container_no'] ?? '');

    try {
        // Build common WHERE fragments
        $where_outgate = "o.new_status = 'exited'";
        $where_vd = "LOWER(TRIM(vd.exit_status)) = 'exited'";

        $params = [];

        if ($filter_container !== '') {
            $where_outgate .= " AND TRIM(o.container_number) = :f_container";
            $params[':f_container'] = $filter_container;
            // restrict vehicle_details by joined container if present
            $where_vd .= " AND EXISTS (SELECT 1 FROM containers c1 WHERE c1.payment_id = vd.payment_id AND TRIM(c1.container_no) = :f_container)";
        }

        if ($filter_vehicle !== '') {
            // try to match appointment vehicle or containers vehicle number in outgate
            $where_outgate .= " AND (
                EXISTS (
                    SELECT 1 FROM appointment_containers ac JOIN appointments ap ON ap.id = ac.appointment_id
                    WHERE TRIM(ac.container_no)=TRIM(o.container_number) AND ap.vehicle_number LIKE :fv_like
                )
                OR EXISTS (
                    SELECT 1 FROM containers c2 WHERE TRIM(c2.container_no)=TRIM(o.container_number) AND c2.vehicle_number LIKE :fv_like
                )
            )";
            $params[':fv_like'] = '%' . $filter_vehicle . '%';

            // vehicle_details filter by model or chassis
            $where_vd .= " AND (vd.vehicle_model LIKE :fv_like OR vd.vehicle_chassis_no LIKE :fv_like)";
        }

        // We will build a UNION ALL that returns same columns for both sources.
        // We'll order so that rows with action_at (outgate) show first (newest), then vehicle_details.
        // Note: for MySQL binding of LIMIT offset may require direct integers; we'll inject safely after casting.

        $union_sql = "
            SELECT
              'outgate' AS source,
              o.action_at AS action_at,
              o.action_by_username AS action_by_username,
              TRIM(o.container_number) AS container_no,
              c.container_size AS container_size,
              p.receipt_no AS receipt_no,
              c.payment_id AS payment_id,
              p.consignee_name AS container_consignee,
              ap.id AS appointment_id,
              ap.appointment_date AS appointment_date,
              ap.appointment_time AS appointment_time,
              1 AS is_exited,
              o.comments AS comments,
              NULL AS vehicle_chassis_no,
              NULL AS vehicle_model,
              NULL AS vehicle_fee,
              NULL AS vehicle_receipt_no,
              NULL AS vehicle_sad_number,
              NULL AS vehicle_consignee_name,
              NULL AS exit_status,
              o.id AS src_id
            FROM outgate_logs o
            LEFT JOIN containers c ON TRIM(c.container_no) = TRIM(o.container_number)
            LEFT JOIN payments p ON p.id = c.payment_id
            LEFT JOIN (
                SELECT ac.container_no, ap.id, ap.appointment_date, ap.appointment_time
                FROM appointment_containers ac
                JOIN appointments ap ON ap.id = ac.appointment_id
            ) ap ON TRIM(ap.container_no) = TRIM(o.container_number)
            WHERE {$where_outgate}

            UNION ALL

            SELECT
              'vehicle_details' AS source,
              NULL AS action_at,
              NULL AS action_by_username,
              TRIM(c.container_no) AS container_no,
              c.container_size AS container_size,
              NULL AS receipt_no,
              c.payment_id AS payment_id,
              NULL AS container_consignee,
              (SELECT ap2.id FROM appointment_containers ac2 JOIN appointments ap2 ON ap2.id=ac2.appointment_id WHERE TRIM(ac2.container_no)=TRIM(c.container_no) ORDER BY ap2.appointment_date DESC, ap2.appointment_time DESC LIMIT 1) AS appointment_id,
              (SELECT ap2.appointment_date FROM appointment_containers ac2 JOIN appointments ap2 ON ap2.id=ac2.appointment_id WHERE TRIM(ac2.container_no)=TRIM(c.container_no) ORDER BY ap2.appointment_date DESC, ap2.appointment_time DESC LIMIT 1) AS appointment_date,
              (SELECT ap2.appointment_time FROM appointment_containers ac2 JOIN appointments ap2 ON ap2.id=ac2.appointment_id WHERE TRIM(ac2.container_no)=TRIM(c.container_no) ORDER BY ap2.appointment_date DESC, ap2.appointment_time DESC LIMIT 1) AS appointment_time,
              CASE WHEN LOWER(TRIM(vd.exit_status)) = 'exited' THEN 1 ELSE 0 END AS is_exited,
              NULL AS comments,
              vd.vehicle_chassis_no AS vehicle_chassis_no,
              vd.vehicle_model AS vehicle_model,
              vd.vehicle_fee AS vehicle_fee,
              vd.vehicle_receipt_no AS vehicle_receipt_no,
              vd.vehicle_sad_number AS vehicle_sad_number,
              vd.vehicle_consignee_name AS vehicle_consignee_name,
              vd.exit_status AS exit_status,
              vd.id AS src_id
            FROM vehicle_details vd
            LEFT JOIN containers c ON c.payment_id = vd.payment_id
            LEFT JOIN payments p2 ON p2.id = c.payment_id
            WHERE {$where_vd}
        ";

        // Count total rows for pagination
        $count_sql = "SELECT COUNT(*) AS cnt FROM ( {$union_sql} ) t";
        $count_stmt = $pdo->prepare($count_sql);
        foreach ($params as $k => $v) $count_stmt->bindValue($k, $v);
        $count_stmt->execute();
        $total = (int)$count_stmt->fetchColumn(0);

        // Now fetch paginated slice
        $page = max(1, $page);
        $per_page = max(1, min(1000, $per_page));
        $offset = ($page - 1) * $per_page;

        // Append ordering & limit/offset
        // Order: rows with action_at first (outgate recent) then vehicle_details (src_id desc)
        $paged_sql = "SELECT * FROM ( {$union_sql} ) t
                      ORDER BY (t.action_at IS NULL), t.action_at DESC, t.src_id DESC
                      LIMIT " . intval($per_page) . " OFFSET " . intval($offset);

        $stmt = $pdo->prepare($paged_sql);
        foreach ($params as $k => $v) $stmt->bindValue($k, $v);
        $stmt->execute();
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Normalize items for JSON: keep fields consistent
        $out = [];
        foreach ($items as $it) {
            $out[] = [
                'source' => $it['source'] ?? '',
                'action_at' => $it['action_at'] ?? null,
                'action_by_username' => $it['action_by_username'] ?? null,
                'container_no' => $it['container_no'] ?? null,
                'container_size' => $it['container_size'] ?? null,
                'receipt_no' => $it['receipt_no'] ?? null,
                'payment_id' => $it['payment_id'] ?? null,
                'container_consignee' => $it['container_consignee'] ?? null,
                'appointment_id' => $it['appointment_id'] ?? null,
                'appointment_date' => $it['appointment_date'] ?? null,
                'appointment_time' => $it['appointment_time'] ?? null,
                'is_exited' => (int)$it['is_exited'] === 1 ? true : false,
                'comments' => $it['comments'] ?? null,
                'vehicle_chassis_no' => $it['vehicle_chassis_no'] ?? null,
                'vehicle_model' => $it['vehicle_model'] ?? null,
                'vehicle_fee' => isset($it['vehicle_fee']) ? (string)$it['vehicle_fee'] : null,
                'vehicle_receipt_no' => $it['vehicle_receipt_no'] ?? null,
                'vehicle_sad_number' => $it['vehicle_sad_number'] ?? null,
                'vehicle_consignee_name' => $it['vehicle_consignee_name'] ?? null,
                'exit_status' => $it['exit_status'] ?? null,
                'src_id' => $it['src_id'] ?? null,
            ];
        }

        $total_pages = (int)ceil($total / $per_page);

        echo json_encode([
            'items' => $out,
            'total' => $total,
            'page' => $page,
            'per_page' => $per_page,
            'total_pages' => $total_pages,
        ]);
        exit;
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Fetch failed: ' . $e->getMessage()]);
        exit;
    }
}

/* ================= Gate Out handler ================= */
$messages = [];
$errors = [];

// Gate out form handling
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'gate_out') {
    $container_no_post = trim($_POST['container_number'] ?? '');
    $payment_id_post = !empty($_POST['payment_id']) ? (int)$_POST['payment_id'] : null;
    $comments_post = trim($_POST['comments'] ?? '');

    if ($container_no_post === '') {
        $errors[] = "Container number required for gate-out.";
    } else {
        try {
            $pdo->beginTransaction();
            if (is_exited($pdo, $container_no_post)) {
                $pdo->rollBack();
                $errors[] = "Container {$container_no_post} already gated out.";
            } else {
                $previous_status = 'unknown';
                if (!$payment_id_post) {
                    $pinfo = get_container_payment_and_payment_info($pdo, $container_no_post);
                    $payment_id_post = $pinfo['payment_id'] ?? null;
                    if (!empty($pinfo['receipt_no'])) $previous_status = 'Paid';
                }
                if ($previous_status === 'unknown') {
                    $s = $pdo->prepare("SELECT appointment_status FROM containers WHERE TRIM(container_no) = TRIM(:c) LIMIT 1");
                    $s->execute([':c' => $container_no_post]);
                    if ($r = $s->fetch(PDO::FETCH_ASSOC)) $previous_status = $r['appointment_status'] ?? $previous_status;
                }
                if ($previous_status === 'unknown') {
                    $s = $pdo->prepare("SELECT is_scanned FROM appointment_containers WHERE TRIM(container_no) = TRIM(:c) LIMIT 1");
                    $s->execute([':c' => $container_no_post]);
                    if ($r = $s->fetch(PDO::FETCH_ASSOC)) $previous_status = ($r['is_scanned'] ? 'scanned' : 'not_scanned');
                }

                $ins = $pdo->prepare("INSERT INTO outgate_logs
                    (container_number, control_room_id, payment_id, previous_status, new_status, action_by, action_by_username, comments, ip_address, user_agent)
                    VALUES (:container_number, NULL, :payment_id, :previous_status, 'exited', :action_by, :action_by_username, :comments, :ip_address, :user_agent)
                ");
                $ins->execute([
                    ':container_number' => $container_no_post,
                    ':payment_id' => $payment_id_post,
                    ':previous_status' => $previous_status,
                    ':action_by' => $_SESSION['user_id'],
                    ':action_by_username' => $_SESSION['username'] ?? '',
                    ':comments' => $comments_post,
                    ':ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
                    ':user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
                ]);

                $pdo->commit();
                $messages[] = "Container {$container_no_post} gated out successfully.";
            }
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $errors[] = "Gate-out failed: " . $e->getMessage();
        }
    }
}

/* ================= Stats ================= */
try {
    $total_unique = (int)$pdo->query("SELECT COUNT(DISTINCT container_no) FROM containers")->fetchColumn();

    $scanned_and_exited = (int)$pdo->query("
        SELECT COUNT(DISTINCT o.container_number)
        FROM outgate_logs o
        WHERE o.new_status = 'exited'
          AND EXISTS (SELECT 1 FROM control_room cr WHERE TRIM(cr.container_number)=TRIM(o.container_number))
    ")->fetchColumn();

    $not_scanned_and_exited = (int)$pdo->query("
        SELECT COUNT(DISTINCT o.container_number)
        FROM outgate_logs o
        WHERE o.new_status = 'exited'
          AND NOT EXISTS (SELECT 1 FROM control_room cr WHERE TRIM(cr.container_number)=TRIM(o.container_number))
    ")->fetchColumn();
} catch (Exception $e) {
    $errors[] = "Stats fetch error: " . $e->getMessage();
    $total_unique = $scanned_and_exited = $not_scanned_and_exited = 0;
}

/* ================= Search handling (GET) ================= */
$container_no = trim($_GET['container_no'] ?? '');
$chassis_no   = trim($_GET['chassis_no'] ?? '');
$vehicle_no   = trim($_GET['vehicle_no'] ?? '');
$status       = trim($_GET['status'] ?? 'not_exited'); // not_exited, exited, all

$vehicle_norm = $vehicle_no !== '' ? normalize_vehicle_token($vehicle_no) : '';

$search_results = ['type' => null, 'records' => []];

try {
    // ---------- Search by container ----------
    if ($container_no !== '') {
        $search_results['type'] = 'container';
        $stmt = $pdo->prepare("
            SELECT ac.*, ap.id AS ap_id, ap.consignee_name, ap.appointment_date, ap.appointment_time, ap.vehicle_number, ap.container_numbers, ap.agency_name
            FROM appointment_containers ac
            JOIN appointments ap ON ap.id = ac.appointment_id
            WHERE TRIM(ac.container_no) = TRIM(:c)
            ORDER BY ac.id
        ");
        $stmt->execute([':c' => $container_no]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($rows)) {
            $byAp = [];
            foreach ($rows as $r) {
                $aid = (int)$r['ap_id'];
                if (!isset($byAp[$aid])) {
                    $byAp[$aid] = [
                        'type' => 'appointment',
                        'id' => $aid,
                        'consignee_name' => $r['consignee_name'],
                        'appointment_date' => $r['appointment_date'],
                        'appointment_time' => $r['appointment_time'],
                        'vehicle_number' => $r['vehicle_number'],
                        'containers' => []
                    ];
                }
                $cn = $r['container_no'];
                $pinfo = get_container_payment_and_payment_info($pdo, $cn);
                $cr = get_control_room($pdo, $cn);
                $exited = is_exited($pdo, $cn);

                if ($status === 'not_exited' && $exited) continue;
                if ($status === 'exited' && !$exited) continue;

                $byAp[$aid]['containers'][] = [
                    'container_no' => $cn,
                    'payment_id' => $pinfo['payment_id'] ?? null,
                    'receipt_no' => $pinfo['receipt_no'] ?? null,
                    'consignee' => $pinfo['consignee_name'] ?? ($r['consignee_name'] ?? null),
                    'is_scanned' => !empty($cr),
                    'control_room' => $cr ?: null,
                    'is_exited' => $exited,
                    'is_stripped' => $r['is_stripped'] ?? 0,
                    'receipt_number' => $r['receipt_number'] ?? null,
                    'container_size' => $pinfo['container_size'] ?? null,
                ];
            }
            foreach ($byAp as $ap) {
                if (!empty($ap['containers'])) $search_results['records'][] = $ap;
            }
        } else {
            // tokenized inside appointments.container_numbers
            $apptLikeStmt = $pdo->prepare("SELECT * FROM appointments WHERE container_numbers LIKE :like ORDER BY appointment_date DESC, appointment_time DESC LIMIT 500");
            $apptLikeStmt->execute([':like' => '%' . $container_no . '%']);
            $apptLikeRows = $apptLikeStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($apptLikeRows as $ap) {
                $tokens = normalize_list_from_string($ap['container_numbers'] ?? '');
                $matched = array_values(array_filter($tokens, fn($t)=>mb_strtoupper(trim($t)) === mb_strtoupper(trim($container_no))));
                if (empty($matched)) continue;
                $containers = [];
                foreach ($matched as $cn) {
                    $pinfo = get_container_payment_and_payment_info($pdo, $cn);
                    $cr = get_control_room($pdo, $cn);
                    $exited = is_exited($pdo, $cn);

                    if ($status === 'not_exited' && $exited) continue;
                    if ($status === 'exited' && !$exited) continue;

                    $containers[] = [
                        'container_no' => $cn,
                        'payment_id' => $pinfo['payment_id'] ?? null,
                        'receipt_no' => $pinfo['receipt_no'] ?? null,
                        'consignee' => $pinfo['consignee_name'] ?? $ap['consignee_name'] ?? null,
                        'is_scanned' => !empty($cr),
                        'control_room' => $cr ?: null,
                        'is_exited' => $exited,
                        'is_stripped' => null,
                        'receipt_number' => null,
                        'container_size' => $pinfo['container_size'] ?? null,
                    ];
                }
                if (!empty($containers)) {
                    $search_results['records'][] = [
                        'type' => 'appointment',
                        'id' => $ap['id'],
                        'consignee_name' => $ap['consignee_name'],
                        'appointment_date' => $ap['appointment_date'],
                        'appointment_time' => $ap['appointment_time'],
                        'vehicle_number' => $ap['vehicle_number'],
                        'containers' => $containers,
                        'agency_name' => $ap['agency_name'] ?? null,
                    ];
                }
            }

            // containers table direct fallback
            if (empty($search_results['records'])) {
                $s = $pdo->prepare("
                    SELECT c.container_no, c.id AS container_id, c.payment_id, p.receipt_no, p.consignee_name, c.container_size
                    FROM containers c
                    LEFT JOIN payments p ON p.id = c.payment_id
                    WHERE TRIM(c.container_no) = TRIM(:c)
                    LIMIT 1
                ");
                $s->execute([':c' => $container_no]);
                $row = $s->fetch(PDO::FETCH_ASSOC);
                if ($row) {
                    $cr = get_control_room($pdo, $row['container_no']);
                    $exited = is_exited($pdo, $row['container_no']);

                    if ($status === 'not_exited' && $exited) {
                        $errors[] = "Container {$container_no} has already been exited.";
                    } elseif ($status === 'exited' && !$exited) {
                        $errors[] = "Container {$container_no} has not been exited (does not match filter).";
                    } else {
                        $search_results['records'][] = [
                            'type' => 'fallback',
                            'container_no' => $row['container_no'],
                            'container_id' => $row['container_id'],
                            'payment_id' => $row['payment_id'],
                            'receipt_no' => $row['receipt_no'],
                            'consignee' => $row['consignee_name'],
                            'is_scanned' => !empty($cr),
                            'control_room' => $cr ?: null,
                            'is_exited' => $exited,
                            'container_size' => $row['container_size'] ?? null,
                        ];
                    }
                } else {
                    $errors[] = "No appointment/container found for {$container_no}.";
                }
            }
        }

    /* ---------- Search by chassis (vehicle_details) ----------
       Now authoritative: search vehicle_details and surface requested fields.
    */
    } elseif ($chassis_no !== '') {
        $search_results['type'] = 'chassis';
        $vdStmt = $pdo->prepare("
            SELECT vd.vehicle_chassis_no, vd.vehicle_model, vd.vehicle_fee, vd.vehicle_receipt_no, vd.vehicle_sad_number, vd.vehicle_consignee_name, vd.exit_status, vd.id,
                   vd.payment_id, TRIM(c.container_no) AS container_no
            FROM vehicle_details vd
            LEFT JOIN containers c ON c.payment_id = vd.payment_id
            WHERE TRIM(vd.vehicle_chassis_no) = TRIM(:ch)
            LIMIT 50
        ");
        $vdStmt->execute([':ch' => $chassis_no]);
        $vdRows = $vdStmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($vdRows)) {
            $errors[] = "No vehicle record found for chassis {$chassis_no}.";
        } else {
            foreach ($vdRows as $vd) {
                $vd_exit_status = isset($vd['exit_status']) ? strtolower(trim($vd['exit_status'])) : 'not_exited';
                $vd_is_exited = ($vd_exit_status === 'exited');

                if ($status === 'not_exited' && $vd_is_exited) continue;
                if ($status === 'exited' && !$vd_is_exited) continue;

                $search_results['records'][] = [
                    'type' => 'vehicle_details',
                    'vehicle_chassis_no' => $vd['vehicle_chassis_no'] ?? '',
                    'vehicle_model' => $vd['vehicle_model'] ?? '',
                    'vehicle_fee' => isset($vd['vehicle_fee']) ? (string)$vd['vehicle_fee'] : null,
                    'vehicle_receipt_no' => $vd['vehicle_receipt_no'] ?? null,
                    'vehicle_sad_number' => $vd['vehicle_sad_number'] ?? null,
                    'vehicle_consignee_name' => $vd['vehicle_consignee_name'] ?? null,
                    'exit_status' => $vd['exit_status'] ?? 'not_exited',
                    'is_exited' => $vd_is_exited,
                    'payment_id' => $vd['payment_id'] ?? null,
                    // we purposely do NOT show container_no/size in vehicle (chassis) UI per your instruction
                ];
            }
        }

    /* ---------- Search by vehicle number ----------
       unchanged logic but ensure fallbacks remain intact
    */
    } elseif ($vehicle_no !== '' ) {
        $search_results['type'] = 'vehicle';
        $stmt = $pdo->prepare("
            SELECT ac.*, ap.id AS ap_id, ap.consignee_name, ap.appointment_date, ap.appointment_time, ap.vehicle_number AS appointment_vehicle, ap.agency_name
            FROM appointment_containers ac
            JOIN appointments ap ON ap.id = ac.appointment_id
            WHERE UPPER(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(ac.vehicle_number, ' ', ''),
                        '-', ''),
                    '/', ''),
                '_', '')
            ) = :v_norm
            ORDER BY ac.id DESC
        ");
        $stmt->execute([':v_norm' => $vehicle_norm]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($rows)) {
            foreach ($rows as $r) {
                $cn = $r['container_no'];
                $pinfo = get_container_payment_and_payment_info($pdo, $cn);
                $cr = get_control_room($pdo, $cn);
                $exited = is_exited($pdo, $cn);

                if ($status === 'not_exited' && $exited) continue;
                if ($status === 'exited' && !$exited) continue;

                $search_results['records'][] = [
                    'type' => 'vehicle_search',
                    'appointment_container_id' => $r['id'],
                    'appointment_id' => $r['ap_id'],
                    'consignee_name' => $r['consignee_name'],
                    'appointment_date' => $r['appointment_date'],
                    'appointment_time' => $r['appointment_time'],
                    'vehicle_number' => $r['vehicle_number'],
                    'agency_name' => $r['agency_name'],
                    'container' => [
                        'container_no' => $cn,
                        'payment_id' => $pinfo['payment_id'] ?? null,
                        'receipt_no' => $pinfo['receipt_no'] ?? null,
                        'consignee' => $pinfo['consignee_name'] ?? $r['consignee_name'],
                        'is_scanned' => !empty($cr),
                        'control_room' => $cr ?: null,
                        'is_exited' => $exited,
                        'is_stripped' => $r['is_stripped'] ?? 0,
                        'goods_description' => $r['goods_description'] ?? null,
                        'container_size' => $pinfo['container_size'] ?? null,
                    ]
                ];
            }
        } else {
            // tokenized appointment.vehicle_number check (existing logic)
            $apStmt = $pdo->prepare("SELECT * FROM appointments WHERE vehicle_number LIKE :like OR TRIM(vehicle_number)=TRIM(:exact) ORDER BY appointment_date DESC, appointment_time DESC LIMIT 1000");
            $apStmt->execute([':like' => '%' . $vehicle_no . '%', ':exact' => $vehicle_no]);
            $apps = $apStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($apps as $ap) {
                $vehTokens = normalize_list_from_string($ap['vehicle_number'] ?? '');
                $match = false;
                foreach ($vehTokens as $t) {
                    if (normalize_vehicle_token($t) === $vehicle_norm) { $match = true; break; }
                }
                if (!$match) continue;

                $acStmt = $pdo->prepare("SELECT * FROM appointment_containers WHERE appointment_id = :aid ORDER BY id");
                $acStmt->execute([':aid' => $ap['id']]);
                $acRows = $acStmt->fetchAll(PDO::FETCH_ASSOC);

                $containers = [];
                if (!empty($acRows)) {
                    foreach ($acRows as $c) {
                        $cn = $c['container_no'];
                        $pinfo = get_container_payment_and_payment_info($pdo, $cn);
                        $cr = get_control_room($pdo, $cn);
                        $exited = is_exited($pdo, $cn);

                        if ($status === 'not_exited' && $exited) continue;
                        if ($status === 'exited' && !$exited) continue;

                        $containers[] = [
                            'container_no' => $cn,
                            'payment_id' => $pinfo['payment_id'] ?? null,
                            'receipt_no' => $pinfo['receipt_no'] ?? null,
                            'consignee' => $pinfo['consignee_name'] ?? null,
                            'is_scanned' => !empty($cr),
                            'control_room' => $cr ?: null,
                            'is_exited' => $exited,
                            'is_stripped' => $c['is_stripped'] ?? 0,
                            'receipt_number' => $c['receipt_number'] ?? null,
                            'container_size' => $pinfo['container_size'] ?? null,
                        ];
                    }
                } else {
                    $list = normalize_list_from_string($ap['container_numbers'] ?? '');
                    foreach ($list as $cn) {
                        $pinfo = get_container_payment_and_payment_info($pdo, $cn);
                        $cr = get_control_room($pdo, $cn);
                        $exited = is_exited($pdo, $cn);

                        if ($status === 'not_exited' && $exited) continue;
                        if ($status === 'exited' && !$exited) continue;

                        $containers[] = [
                            'container_no' => $cn,
                            'payment_id' => $pinfo['payment_id'] ?? null,
                            'receipt_no' => $pinfo['receipt_no'] ?? null,
                            'consignee' => $pinfo['consignee_name'] ?? null,
                            'is_scanned' => !empty($cr),
                            'control_room' => $cr ?: null,
                            'is_exited' => $exited,
                            'is_stripped' => null,
                            'receipt_number' => null,
                            'container_size' => $pinfo['container_size'] ?? null,
                        ];
                    }
                }

                if (!empty($containers)) {
                    $search_results['records'][] = [
                        'type' => 'appointment',
                        'id' => $ap['id'],
                        'consignee_name' => $ap['consignee_name'],
                        'appointment_date' => $ap['appointment_date'],
                        'appointment_time' => $ap['appointment_time'],
                        'vehicle_number' => $ap['vehicle_number'],
                        'agency_name' => $ap['agency_name'] ?? null,
                        'containers' => $containers
                    ];
                }
            }

            // fallback containers table normalized vehicle
            if (empty($search_results['records'])) {
                $s = $pdo->prepare("
                    SELECT c.container_no, c.vehicle_number, c.payment_id, p.receipt_no, p.consignee_name, c.container_size
                    FROM containers c
                    LEFT JOIN payments p ON p.id = c.payment_id
                    WHERE UPPER(
                        REPLACE(
                            REPLACE(
                                REPLACE(
                                    REPLACE(c.vehicle_number, ' ', ''),
                                '-', ''),
                            '/', ''),
                        '_', '')
                    ) = :v_norm
                    ORDER BY c.id DESC
                    LIMIT 50
                ");
                $s->execute([':v_norm' => $vehicle_norm]);
                $rows = $s->fetchAll(PDO::FETCH_ASSOC);
                if (!empty($rows)) {
                    foreach ($rows as $row) {
                        $cr = get_control_room($pdo, $row['container_no']);
                        $exited = is_exited($pdo, $row['container_no']);

                        if ($status === 'not_exited' && $exited) continue;
                        if ($status === 'exited' && !$exited) continue;

                        $search_results['records'][] = [
                            'type' => 'container_vehicle_fallback',
                            'vehicle_number' => $row['vehicle_number'],
                            'container_no' => $row['container_no'],
                            'payment_id' => $row['payment_id'],
                            'receipt_no' => $row['receipt_no'],
                            'consignee' => $row['consignee_name'] ?? '',
                            'is_scanned' => !empty($cr),
                            'control_room' => $cr ?: null,
                            'is_exited' => $exited,
                            'container_size' => $row['container_size'] ?? null,
                        ];
                    }
                } else {
                    $errors[] = "No record found for vehicle {$vehicle_no}.";
                }
            }
        }
    }

} catch (Exception $e) {
    $errors[] = "Search error: " . $e->getMessage();
}

/* ================= Modal default records: (NONE - lazy load) ================= */

/* ================= PDF generation from Modal (POST action=generate_pdf) ================= */
/* unchanged pattern: server-side PDF generation authoritative (uses outgate_logs.action_at) */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'generate_pdf') {
    $modal_date_from = trim($_POST['date_from'] ?? '');
    $modal_date_to   = trim($_POST['date_to'] ?? '');
    $modal_time_from = trim($_POST['time_from'] ?? '');
    $modal_time_to   = trim($_POST['time_to'] ?? '');
    $modal_status    = trim($_POST['modal_status'] ?? 'exited');
    $hidden_vehicle  = trim($_POST['vehicle_no'] ?? '');
    $hidden_container = trim($_POST['container_no'] ?? '');

    try {
        $sql = "
            SELECT
              o.id AS out_id,
              TRIM(o.container_number) AS container_number,
              o.action_at,
              o.action_by_username,
              o.comments,
              cr.scan_station,
              cr.scan_date,
              c.container_size,
              c.payment_id,
              p.receipt_no,
              p.consignee_name,
              (SELECT ap.id FROM appointment_containers ac JOIN appointments ap ON ap.id=ac.appointment_id WHERE TRIM(ac.container_no)=TRIM(o.container_number) ORDER BY ap.appointment_date DESC, ap.appointment_time DESC LIMIT 1) AS ap_id,
              (SELECT ap.appointment_date FROM appointment_containers ac JOIN appointments ap ON ap.id=ac.appointment_id WHERE TRIM(ac.container_no)=TRIM(o.container_number) ORDER BY ap.appointment_date DESC, ap.appointment_time DESC LIMIT 1) AS ap_date,
              (SELECT ap.appointment_time FROM appointment_containers ac JOIN appointments ap ON ap.id=ac.appointment_id WHERE TRIM(ac.container_no)=TRIM(o.container_number) ORDER BY ap.appointment_date DESC, ap.appointment_time DESC LIMIT 1) AS ap_time,
              (SELECT ap.vehicle_number FROM appointment_containers ac JOIN appointments ap ON ap.id=ac.appointment_id WHERE TRIM(ac.container_no)=TRIM(o.container_number) ORDER BY ap.appointment_date DESC, ap.appointment_time DESC LIMIT 1) AS ap_vehicle
            FROM outgate_logs o
            LEFT JOIN control_room cr ON TRIM(cr.container_number)=TRIM(o.container_number)
            LEFT JOIN containers c ON TRIM(c.container_no)=TRIM(o.container_number)
            LEFT JOIN payments p ON p.id = c.payment_id
            WHERE o.new_status = 'exited'
        ";

        $params = [];

        if ($hidden_container !== '') {
            $sql .= " AND TRIM(o.container_number) = TRIM(:container_no) ";
            $params[':container_no'] = $hidden_container;
        }

        if ($hidden_vehicle !== '') {
            $sql .= " AND (
                EXISTS (
                    SELECT 1 FROM appointment_containers ac JOIN appointments ap ON ap.id=ac.appointment_id
                    WHERE TRIM(ac.container_no)=TRIM(o.container_number) AND ap.vehicle_number LIKE :veh_like
                )
                OR EXISTS (
                    SELECT 1 FROM containers c2 WHERE TRIM(c2.container_no)=TRIM(o.container_number) AND c2.vehicle_number LIKE :veh_like
                )
            )";
            $params[':veh_like'] = '%' . $hidden_vehicle . '%';
        }

        if ($modal_date_from !== '') {
            $start_time = $modal_time_from ?: '00:00:00';
            $start = $modal_date_from . ' ' . $start_time;
            $sql .= " AND o.action_at >= :start_at ";
            $params[':start_at'] = $start;
        }
        if ($modal_date_to !== '') {
            $end_time = $modal_time_to ?: '23:59:59';
            $end = $modal_date_to . ' ' . $end_time;
            $sql .= " AND o.action_at <= :end_at ";
            $params[':end_at'] = $end;
        }

        $sql .= " ORDER BY o.action_at DESC LIMIT 5000";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $pdf_rows = [];
        foreach ($rows as $r) {
            $pdf_rows[] = [
                'container_no' => $r['container_number'] ?? '',
                'container_size' => $r['container_size'] ?? null,
                'consignee' => $r['conscience'] ?? $r['conscience'] ?? $r['conscience'] ?? ($r['conscience'] ?? ($r['conscience'] ?? $r['conscience'] ?? null)),
                'vehicle_number' => $r['ap_vehicle'] ?? '',
                'is_scanned' => !empty($r['scan_date']),
                'control_room' => [
                    'scan_station' => $r['scan_station'] ?? null,
                    'scan_date' => $r['scan_date'] ?? null,
                ],
                'is_exited' => true,
                'payment_id' => $r['payment_id'] ?? null,
                'receipt_no' => $r['receipt_no'] ?? null,
                'action_at' => $r['action_at'] ?? null,
                'action_by_username' => $r['action_by_username'] ?? null,
                'comments' => $r['comments'] ?? null,
                'appointment_date' => $r['ap_date'] ?? null,
                'appointment_time' => $r['ap_time'] ?? null,
            ];
        }

        // Company info + TCPDF generation (same as before)
        $company = [
            'name' => 'NICK TC-SCAN (GAMBIA) LTD',
            'phone' => '+220 6111 222',
            'email' => 'info@nicktcscangambia.gm',
            'website' => 'www.nicktcscangambia.gm',
            'address' => '35 Kombo Sillah Drive, OJ Junction, Serekunda'
        ];

        try {
            require_once('tcpdf/tcpdf.php');

            class MYPDF extends TCPDF {
                public function Footer() {
                    $this->SetY(-15);
                    $this->SetFont('helvetica', 'I', 8);
                    $this->SetTextColor(100, 100, 100);
                    $this->Cell(0, 10, '© ' . date('Y') . ' NICK TC-SCAN (GAMBIA) LTD. | Page ' . $this->getAliasNumPage() . '/' . $this->getAliasNbPages(), 0, false, 'C');
                }
            }

            ini_set('memory_limit', '1024M');
            set_time_limit(300);

            $pdf = new MYPDF('P', PDF_UNIT, 'A4', true, 'UTF-8', false);
            $pdf->SetCreator('NICK TC-SCAN');
            $pdf->SetAuthor($_SESSION['username'] ?? 'exit_officer');
            $pdf->SetTitle('Exit Officer Report');
            $pdf->SetMargins(15, 28, 15);
            $pdf->SetHeaderMargin(8);
            $pdf->SetFooterMargin(18);
            $pdf->SetAutoPageBreak(TRUE, 18);
            $pdf->AddPage();

            // Header and content (kept as in your previous implementation)
            $pdf->SetFillColor(139, 0, 0);
            $barHeight = 26;
            $pdf->Rect(0, 0, $pdf->getPageWidth(), $barHeight, 'F');
            $pdf->SetTextColor(255,255,255);
            $pdf->SetFont('helvetica', 'B', 16);
            $pdf->SetXY(14, 6);
            $pdf->Cell(0, 8, $company['name'], 0, 1, 'L', 0);
            $pdf->SetFont('helvetica', '', 9);
            $pdf->SetXY(14, 14);
            $pdf->Cell(0, 6, "Tel: {$company['phone']} | Email: {$company['email']}", 0, 1, 'L', 0);
            $pdf->SetXY(14, 19);
            $pdf->Cell(0, 6, "Website: {$company['website']} | Address: {$company['address']}", 0, 1, 'L', 0);

            $logoWidth = 38; $logoHeight = 22;
            $xPosition = $pdf->getPageWidth() - $logoWidth - 12;
            if (file_exists('logo.png')) {
                $pdf->Image('logo.png', $xPosition, 4, $logoWidth, $logoHeight, '', '', '', false, 300);
            }

            $pdf->Ln(6);
            $pdf->SetTextColor(33,33,33);
            $pdf->SetFont('helvetica', 'B', 12);
            $pdf->Cell(0, 7, 'Exit Officer — Container Report', 0, 1);
            $pdf->SetFont('helvetica', '', 9);
            $pdf->Cell(0, 6, 'Generated: ' . date('Y-m-d H:i:s'), 0, 1);
            $pdf->Ln(4);

            // summaries
            $total_count = count($pdf_rows);
            $count_20 = 0; $count_40 = 0; $count_45 = 0;
            foreach ($pdf_rows as $r) {
                $sz = (string)($r['container_size'] ?? '');
                if (strpos($sz, '20') !== false) $count_20++;
                if (strpos($sz, '40') !== false) $count_40++;
                if (strpos($sz, '45') !== false) $count_45++;
            }

            $summaryHtml = <<<SUM
            <table cellpadding="4" cellspacing="0" border="0" style="font-size:10pt;">
                <tr>
                    <td><strong>Total records:</strong> {$total_count}</td>
                    <td><strong>20ft:</strong> {$count_20}</td>
                    <td><strong>40ft:</strong> {$count_40}</td>
                    <td><strong>45ft:</strong> {$count_45}</td>
                </tr>
            </table>
            SUM;

            $pdf->writeHTML($summaryHtml, false, false, false, false, '');

            // detail table
            $tbl = '<style>
            .t th{background-color:#8B0000;color:#fff;padding:6px 4px;font-weight:bold;}
            .t td{padding:6px 4px;border-bottom:1px solid #eee;font-size:9pt;}
            </style>';
            $tbl .= '<table cellpadding="4" cellspacing="0" border="0" width="100%" class="t">';
            $tbl .= '<thead><tr style="background:#8B0000;color:#fff;font-weight:bold;">
                <th width="10%">Container</th>
                <th width="8%">Size</th>
                <th width="15%">Consignee</th>
                <th width="15%">Vehicle</th>
                <th width="10%">Scanned</th>
                <th width="10%">Exited</th>
                <th width="18%">Action Date</th>
                <th width="14%">Payment/Receipt</th>
            </tr></thead><tbody>';

            if (empty($pdf_rows)) {
                $tbl .= '<tr><td colspan="8" style="text-align:center;padding:10px;">No records found for selected filters.</td></tr>';
            } else {
                foreach ($pdf_rows as $r) {
                    $scan_dt = $r['action_at'] ?? $r['control_room']['scan_date'] ?? $r['appointment_date'] ?? '';
                    $scan_dt_fmt = $scan_dt ? h(date('Y-m-d H:i', strtotime($scan_dt))) : 'N/A';
                    $scanned = !empty($r['is_scanned']) ? 'Yes' : 'No';
                    $exited = !empty($r['is_exited']) ? 'Yes' : 'No';
                    $pay = h(($r['payment_id'] ?? '') . ' / ' . ($r['receipt_no'] ?? ''));
                    $tbl .= '<tr>';
                    $tbl .= '<td>' . h($r['container_no'] ?? '') . '</td>';
                    $tbl .= '<td>' . h($r['container_size'] ?? '—') . '</td>';
                    $tbl .= '<td>' . h($r['consignee'] ?? '') . '</td>';
                    $tbl .= '<td>' . h($r['vehicle_number'] ?? '') . '</td>';
                    $tbl .= '<td>' . $scanned . '</td>';
                    $tbl .= '<td>' . $exited . '</td>';
                    $tbl .= '<td>' . $scan_dt_fmt . '</td>';
                    $tbl .= '<td>' . $pay . '</td>';
                    $tbl .= '</tr>';
                }
            }

            $tbl .= '</tbody></table>';
            $pdf->Ln(6);
            $pdf->writeHTML($tbl, true, false, false, false, '');

            // signatures
            $pdf->Ln(8);
            $pdf->SetFont('helvetica', '', 9);
            $signHtml = <<<SIG
            <table cellpadding="6" cellspacing="0" border="0" width="100%">
                <tr>
                    <td width="50%" style="border-top:1px solid #8B0000;"><strong>SYSTEM CONTROLLER</strong><br/><small>Date: {date}</small></td>
                    <td width="50%" style="border-top:1px solid #8B0000;text-align:right;"><strong>SUPERVISOR/MANAGER</strong><br/><small>Name:</small></td>
                </tr>
            </table>
            SIG;
            $signHtml = str_replace('{date}', date('Y-m-d'), $signHtml);
            $pdf->writeHTML($signHtml, true, false, false, false, '');

            if (ob_get_length()) { @ob_end_clean(); }
            $pdf->Output('exit_officer_report_' . date('Ymd_His') . '.pdf', 'D');
            exit;
        } catch (Exception $e) {
            $errors[] = "PDF generation failed: " . $e->getMessage();
        }

    } catch (Exception $e) {
        $errors[] = "PDF query failed: " . $e->getMessage();
    }
}

/* ================= UI Rendering ================= */
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Exit Officer Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet"/>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
  <style>
    .stat-card { background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color: white; border:none; }
    .stat-card.success { background: linear-gradient(135deg,#4facfe 0%,#00f2fe 100%); }
    .stat-card.warning { background: linear-gradient(135deg,#43e97b 0%,#38f9d7 100%); }
    .action-button { min-width:120px; margin:2px 0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Helvetica Neue", monospace; }

    .container-badge {
        display:inline-block; padding:.25rem .5rem; border-radius:.35rem;
        background: linear-gradient(90deg,#fff 0,#f1f5f9 100%);
        border: 1px solid rgba(0,0,0,0.06); box-shadow:0 2px 12px rgba(102,126,234,0.06);
        font-weight:700; color:#0b1220;
    }
    .size-badge {
        display:inline-block; padding:.2rem .45rem; border-radius:.35rem;
        background: linear-gradient(90deg,#e6fffa 0,#f0fff4 100%);
        border:1px solid rgba(56,189,248,0.15); font-weight:700; color:#064e3b;
    }
    .vehicle-highlight {
        background-color:#fff3cd; padding:.18rem .36rem; border-radius:.25rem; font-weight:700; color:#856404;
        border:1px solid #ffeaa7;
    }
    .vehicle-highlight mark { background:inherit; border:none; padding:0; }
    .friendly-note {
        background: linear-gradient(90deg, rgba(102,126,234,0.06), rgba(76,175,80,0.03));
        border-left: 4px solid rgba(102,126,234,0.35);
        padding:12px; border-radius:8px; margin-bottom:16px; color:#1f2937;
    }

    /* Modal UI */
    .report-modal .modal-dialog { max-width: 1200px; }
    .report-modal .modal-content {
        background: rgba(255,255,255,0.95); backdrop-filter: blur(6px);
        border-radius:12px; border:1px solid rgba(0,0,0,0.04);
    }
    .neon-dot { width:14px; height:14px; border-radius:50%; background: linear-gradient(90deg,#7c3aed,#06b6d4); box-shadow: 0 6px 20px rgba(99,102,241,0.22); }

    /* responsive table -> cards on mobile */
    .responsive-table { width:100%; border-collapse: collapse; }
    .responsive-table th, .responsive-table td { padding:.6rem; border-bottom:1px solid #eef2ff; text-align:left; font-size:.95rem; }
    @media (max-width: 768px) {
        .responsive-table, .responsive-table thead, .responsive-table tbody, .responsive-table th, .responsive-table td, .responsive-table tr { display:block; width:100%; }
        .responsive-table thead tr { display:none; }
        .responsive-row { margin-bottom:12px; background:white; border-radius:8px; padding:12px; box-shadow:0 6px 16px rgba(2,6,23,0.04); }
        .responsive-row .label { font-weight:700; color:#374151; display:block; margin-bottom:6px; }
        .responsive-row .value { color:#111827; display:block; margin-bottom:6px; }
    }
    @media (min-width:1200px) { .report-modal .modal-dialog { max-width:1400px; } .report-modal .modal-content { border-radius:14px; } }

    .small-muted { font-size: .85rem; color: #6b7280; }
  </style>
</head>
<body>
<div class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
            <h3 class="mb-0">Exit Officer Dashboard</h3>
            <small class="text-muted">Logged in as <?= h($_SESSION['username'] ?? 'Unknown') ?></small>
        </div>
        <div class="d-flex align-items-center gap-3">
            <small class="text-muted">Role: <?= h($_SESSION['role'] ?? '') ?></small>
            <a href="logout.php" class="btn btn-danger btn-sm"><i class="fas fa-sign-out-alt"></i> Logout</a>
        </div>
    </div>

    <?php foreach ($messages as $m): ?><div class="alert alert-success"><?= h($m) ?></div><?php endforeach; ?>
    <?php foreach ($errors as $e): ?><div class="alert alert-warning"><?= h($e) ?></div><?php endforeach; ?>

    <div class="row mb-3">
        <div class="col-md-4"><div class="card p-3 stat-card"><h6>Total unique containers</h6><h2><?= h($total_unique) ?></h2></div></div>
        <div class="col-md-4"><div class="card p-3 stat-card success"><h6>Scanned & Exited</h6><h2><?= h($scanned_and_exited) ?></h2></div></div>
        <div class="col-md-4"><div class="card p-3 stat-card warning"><h6>Not Scanned & Exited</h6><h2><?= h($not_scanned_and_exited) ?></h2></div></div>
    </div>

    <div class="friendly-note">
        <strong>Search Vehicle, Container, or Chassis to see all available records.</strong>
        <div class="small mt-1">Tip: you can also filter by <em>status</em> on the main form. For date/time filtering and PDF export, use <strong>Generate Report</strong> (opens the report modal and lazy-loads its contents).</div>
    </div>

    <div class="card mb-4"><div class="card-body">
        <form method="get" class="row g-2 align-items-center">
            <div class="col-md-3"><input name="vehicle_no" class="form-control" placeholder="Vehicle number" value="<?= h($vehicle_no) ?>"></div>
            <div class="col-md-3"><input name="container_no" class="form-control" placeholder="Container" value="<?= h($container_no) ?>"></div>
            <div class="col-md-3"><input name="chassis_no" class="form-control" placeholder="Chassis number" value="<?= h($chassis_no) ?>"></div>
            <div class="col-md-2">
                <select name="status" class="form-select">
                    <option value="not_exited" <?= $status === 'not_exited' ? 'selected' : '' ?>>Not Exited (default)</option>
                    <option value="exited" <?= $status === 'exited' ? 'selected' : '' ?>>Exited</option>
                    <option value="all" <?= $status === 'all' ? 'selected' : '' ?>>All</option>
                </select>
            </div>
            <div class="col-md-1 d-flex gap-2"><button class="btn btn-primary">Search</button></div>

            <div class="col-12 mt-3 d-flex justify-content-between align-items-center">
                <div>
                    <button type="button" id="openReportBtn" class="btn btn-outline-info" data-bs-toggle="modal" data-bs-target="#reportModal">
                        <i class="fas fa-file-lines"></i> Generate Report
                    </button>
                </div>
                <div><a href="<?= strtok($_SERVER["REQUEST_URI"], '?') ?>" class="btn btn-outline-secondary">Reset filter</a></div>
            </div>
        </form>
    </div></div>

    <!-- Render search results -->
    <?php if (!empty($_GET) && $search_results['type'] && !empty($search_results['records'])): ?>
        <?php foreach ($search_results['records'] as $rec): ?>
            <?php if (($rec['type'] ?? '') === 'appointment'): ?>
                <div class="card mb-3"><div class="card-body">
                    <h6>Appointment #<?= h($rec['id']) ?> — <?= h($rec['consignee_name']) ?> <small class="text-muted">[<?= h(($rec['appointment_date'] ?? '') . ' ' . ($rec['appointment_time'] ?? '')) ?>]</small>
                        <span class="ms-2"><?= highlight_match($rec['vehicle_number'] ?? '', $vehicle_no) ?></span>
                    </h6>
                    <?php if (empty($rec['containers'])): ?>
                        <div class="alert alert-secondary mt-2">No containers recorded for this appointment.</div>
                    <?php else: foreach ($rec['containers'] as $c):
                        $modalId = make_modal_id($rec['id'] ?? 0, $c['container_no']);
                    ?>
                        <div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-start">
                            <div>
                                <div><strong>Container:</strong> <span class="container-badge"><?= h($c['container_no']) ?></span></div>
                                <div class="mt-1"><strong>Size:</strong> <span class="size-badge"><?= h($c['container_size'] ?? '—') ?></span></div>
                                <div class="mt-1"><strong>Payment ID:</strong> <?= h($c['payment_id'] ?? '') ?> — <strong>Receipt:</strong> <?= h($c['receipt_no'] ?? ($c['receipt_number'] ?? '')) ?></div>
                                <div class="mt-1"><strong>Consignee:</strong> <?= h($c['consignee'] ?? '') ?></div>
                                <div class="mt-1"><strong>Scanned:</strong> <?= $c['is_scanned'] ? 'Yes' : 'No' ?><?= !empty($c['control_room']) ? ' — '.h($c['control_room']['scan_station'].' '.($c['control_room']['scan_date'] ?? '')) : '' ?></div>
                                <div class="mt-1"><strong>Exited:</strong> <?= $c['is_exited'] ? 'Yes' : 'No' ?></div>
                            </div>

                            <div style="min-width:260px">
                                <?php if (!$c['is_exited']): ?>
                                    <form method="post" class="mb-2">
                                        <input type="hidden" name="action" value="gate_out">
                                        <input type="hidden" name="container_number" value="<?= h($c['container_no']) ?>">
                                        <input type="hidden" name="payment_id" value="<?= h($c['payment_id'] ?? '') ?>">
                                        <div class="input-group">
                                            <input name="comments" class="form-control form-control-sm" placeholder="Comment">
                                            <button class="btn btn-success btn-sm action-button">Gate Out</button>
                                        </div>
                                    </form>
                                <?php else: ?>
                                    <div class="mb-2"><span class="badge bg-secondary">Already gated out</span></div>
                                <?php endif; ?>
                                <button class="btn btn-outline-primary btn-sm action-button" data-bs-toggle="modal" data-bs-target="#<?= h($modalId) ?>">View</button>
                            </div>
                        </div>

                        <!-- Modal per container (main) -->
                        <div class="modal fade" id="<?= h($modalId) ?>" tabindex="-1" aria-hidden="true">
                          <div class="modal-dialog modal-lg"><div class="modal-content">
                            <div class="modal-header">
                              <h5 class="modal-title">Container <?= h($c['container_no']) ?> details</h5>
                              <button class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                              <dl class="row">
                                <dt class="col-4">Container</dt><dd class="col-8"><?= h($c['container_no']) ?></dd>
                                <dt class="col-4">Size</dt><dd class="col-8"><?= h($c['container_size'] ?? '—') ?></dd>
                                <dt class="col-4">Payment ID</dt><dd class="col-8"><?= h($c['payment_id'] ?? '') ?></dd>
                                <dt class="col-4">Receipt</dt><dd class="col-8"><?= h($c['receipt_no'] ?? ($c['receipt_number'] ?? '')) ?></dd>
                                <dt class="col-4">Consignee</dt><dd class="col-8"><?= h($c['consignee'] ?? '') ?></dd>
                                <dt class="col-4">Scanned</dt><dd class="col-8"><?= $c['is_scanned'] ? 'Yes' : 'No' ?></dd>
                                <dt class="col-4">Scan details</dt><dd class="col-8"><?= !empty($c['control_room']) ? h(($c['control_room']['scan_station'] ?? '') . ' ' . ($c['control_room']['scan_date'] ?? '')) : 'N/A' ?></dd>
                                <dt class="col-4">Exited</dt><dd class="col-8"><?= $c['is_exited'] ? 'Yes' : 'No' ?></dd>
                                <dt class="col-4">Stripped</dt><dd class="col-8"><?= isset($c['is_stripped']) ? ($c['is_stripped'] ? 'Yes' : 'No') : 'N/A' ?></dd>
                              </dl>
                            </div>
                          </div></div>
                        </div>
                    <?php endforeach; endif; ?>
                </div></div>

            <?php elseif (($rec['type'] ?? '') === 'vehicle_details'): ?>
                <?php
                    $modalId = make_modal_id(0, 'chassis_' . ($rec['vehicle_chassis_no'] ?? ''));
                ?>
                <div class="card mb-3"><div class="card-body">
                    <h6>Chassis: <?= h($rec['vehicle_chassis_no'] ?? '') ?> <small class="text-muted">Model: <?= h($rec['vehicle_model'] ?? '') ?></small></h6>
                    <div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-start">
                        <div>
                            <div><strong>Fee:</strong> <?= h($rec['vehicle_fee'] ?? '—') ?></div>
                            <div class="mt-1"><strong>Receipt Number:</strong> <?= h($rec['vehicle_receipt_no'] ?? '—') ?></div>
                            <div class="mt-1"><strong>SAD Number:</strong> <?= h($rec['vehicle_sad_number'] ?? '—') ?></div>
                            <div class="mt-1"><strong>Consignee:</strong> <?= h($rec['vehicle_consignee_name'] ?? '') ?></div>
                            <div class="mt-1"><strong>Status:</strong> <?= h($rec['exit_status'] ?? 'not_exited') ?></div>
                        </div>
                        <div style="min-width:260px">
                            <?php if (empty($rec['is_exited'])): ?>
                                <div class="mb-2"><span class="badge bg-warning">Not exited</span></div>
                            <?php else: ?>
                                <div class="mb-2"><span class="badge bg-secondary">Marked exited</span></div>
                            <?php endif; ?>
                            <button class="btn btn-outline-primary btn-sm action-button" data-bs-toggle="modal" data-bs-target="#<?= h($modalId) ?>">View</button>
                        </div>
                    </div>

                    <div class="modal fade" id="<?= h($modalId) ?>" tabindex="-1" aria-hidden="true">
                      <div class="modal-dialog modal-lg"><div class="modal-content">
                        <div class="modal-header">
                          <h5 class="modal-title">Chassis <?= h($rec['vehicle_chassis_no'] ?? '') ?> details</h5>
                          <button class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                          <dl class="row">
                            <dt class="col-4">Chassis</dt><dd class="col-8"><?= h($rec['vehicle_chassis_no'] ?? '') ?></dd>
                            <dt class="col-4">Model</dt><dd class="col-8"><?= h($rec['vehicle_model'] ?? '') ?></dd>
                            <dt class="col-4">Fee</dt><dd class="col-8"><?= h($rec['vehicle_fee'] ?? '—') ?></dd>
                            <dt class="col-4">Receipt Number</dt><dd class="col-8"><?= h($rec['vehicle_receipt_no'] ?? '—') ?></dd>
                            <dt class="col-4">SAD Number</dt><dd class="col-8"><?= h($rec['vehicle_sad_number'] ?? '—') ?></dd>
                            <dt class="col-4">Consignee</dt><dd class="col-8"><?= h($rec['vehicle_consignee_name'] ?? '') ?></dd>
                            <dt class="col-4">Status</dt><dd class="col-8"><?= h($rec['exit_status'] ?? '') ?></dd>
                          </dl>
                        </div>
                      </div></div>
                    </div>

                </div></div>

            <?php elseif (($rec['type'] ?? '') === 'vehicle_search'): ?>
                <?php $cont = $rec['container']; $modalId = make_modal_id($rec['appointment_id'] ?? 0, $cont['container_no'] ?? 'x'); ?>
                <div class="card mb-3"><div class="card-body">
                    <h6>Vehicle: <?= highlight_match($rec['vehicle_number'] ?? '', $vehicle_no) ?> <small class="text-muted">[<?= h(($rec['appointment_date'] ?? '') . ' ' . ($rec['appointment_time'] ?? '')) ?>]</small></h6>
                    <div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-start">
                        <div>
                            <div><strong>Container:</strong> <span class="container-badge"><?= h($cont['container_no'] ?? '') ?></span></div>
                            <div class="mt-1"><strong>Size:</strong> <span class="size-badge"><?= h($cont['container_size'] ?? '—') ?></span></div>
                            <div class="mt-1"><strong>Payment ID:</strong> <?= h($cont['payment_id'] ?? '') ?> — <strong>Receipt:</strong> <?= h($cont['receipt_no'] ?? '') ?></div>
                            <div class="mt-1"><strong>Consignee:</strong> <?= h($cont['consignee'] ?? '') ?></div>
                            <div class="mt-1"><strong>Scanned:</strong> <?= !empty($cont['is_scanned']) ? 'Yes' : 'No' ?><?= !empty($cont['control_room']) ? ' — '.h($cont['control_room']['scan_station'].' '.($cont['control_room']['scan_date'] ?? '')) : '' ?></div>
                            <div class="mt-1"><strong>Exited:</strong> <?= !empty($cont['is_exited']) ? 'Yes' : 'No' ?></div>
                        </div>
                        <div style="min-width:260px">
                            <?php if (empty($cont['is_exited'])): ?>
                                <form method="post" class="mb-2">
                                    <input type="hidden" name="action" value="gate_out">
                                    <input type="hidden" name="container_number" value="<?= h($cont['container_no'] ?? '') ?>">
                                    <input type="hidden" name="payment_id" value="<?= h($cont['payment_id'] ?? '') ?>">
                                    <div class="input-group">
                                        <input name="comments" class="form-control form-control-sm" placeholder="Comment">
                                        <button class="btn btn-success btn-sm action-button">Gate Out</button>
                                    </div>
                                </form>
                            <?php else: ?>
                                <div class="mb-2"><span class="badge bg-secondary">Already gated out</span></div>
                            <?php endif; ?>
                            <button class="btn btn-outline-primary btn-sm action-button" data-bs-toggle="modal" data-bs-target="#<?= h($modalId) ?>">View</button>
                        </div>
                    </div>
                    <!-- Modal per container -->
                    <div class="modal fade" id="<?= h($modalId) ?>" tabindex="-1" aria-hidden="true">
                      <div class="modal-dialog modal-lg"><div class="modal-content">
                        <div class="modal-header">
                          <h5 class="modal-title">Container <?= h($cont['container_no'] ?? '') ?> details</h5>
                          <button class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                          <dl class="row">
                            <dt class="col-4">Container</dt><dd class="col-8"><?= h($cont['container_no'] ?? '') ?></dd>
                            <dt class="col-4">Size</dt><dd class="col-8"><?= h($cont['container_size'] ?? '—') ?></dd>
                            <dt class="col-4">Payment ID</dt><dd class="col-8"><?= h($cont['payment_id'] ?? '') ?></dd>
                            <dt class="col-4">Receipt</dt><dd class="col-8"><?= h($cont['receipt_no'] ?? '') ?></dd>
                            <dt class="col-4">Consignee</dt><dd class="col-8"><?= h($cont['consignee'] ?? '') ?></dd>
                            <dt class="col-4">Scanned</dt><dd class="col-8"><?= !empty($cont['is_scanned']) ? 'Yes' : 'No' ?></dd>
                            <dt class="col-4">Scan details</dt><dd class="col-8"><?= !empty($cont['control_room']) ? h(($cont['control_room']['scan_station'] ?? '') . ' ' . ($cont['control_room']['scan_date'] ?? '')) : 'N/A' ?></dd>
                            <dt class="col-4">Exited</dt><dd class="col-8"><?= !empty($cont['is_exited']) ? 'Yes' : 'No' ?></dd>
                            <dt class="col-4">Stripped</dt><dd class="col-8"><?= isset($cont['is_stripped']) ? ($cont['is_stripped'] ? 'Yes' : 'No') : 'N/A' ?></dd>
                            <dt class="col-4">Goods</dt><dd class="col-8"><?= h($cont['goods_description'] ?? '') ?></dd>
                          </dl>
                        </div>
                      </div></div>
                    </div>
                </div></div>

            <?php else: ?>
                <!-- fallback single container -->
                <?php $cn = $rec['container_no'] ?? ''; $modalId = make_modal_id($cn, $cn); ?>
                <div class="card mb-3"><div class="card-body">
                    <div><strong>Container:</strong> <span class="container-badge"><?= h($rec['container_no'] ?? '') ?></span></div>
                    <div class="mt-1"><strong>Size:</strong> <span class="size-badge"><?= h($rec['container_size'] ?? '—') ?></span></div>
                    <div class="mt-1"><strong>Payment ID:</strong> <?= h($rec['payment_id'] ?? '') ?> — <strong>Receipt:</strong> <?= h($rec['receipt_no'] ?? '') ?></div>
                    <div class="mt-1"><strong>Consignee:</strong> <?= h($rec['consignee'] ?? '') ?></div>
                    <div class="mt-1"><strong>Scanned:</strong> <?= !empty($rec['is_scanned']) ? 'Yes' : 'No' ?></div>
                    <div class="mt-1"><strong>Exited:</strong> <?= !empty($rec['is_exited']) ? 'Yes' : 'No' ?></div>

                    <?php if (empty($rec['is_exited'])): ?>
                        <form method="post" class="my-2">
                            <input type="hidden" name="action" value="gate_out">
                            <input type="hidden" name="container_number" value="<?= h($rec['container_no'] ?? '') ?>">
                            <input type="hidden" name="payment_id" value="<?= h($rec['payment_id'] ?? '') ?>">
                            <div class="input-group">
                                <input name="comments" class="form-control form-control-sm" placeholder="Comment">
                                <button class="btn btn-success btn-sm action-button">Gate Out</button>
                            </div>
                        </form>
                    <?php else: ?>
                        <div class="mb-2"><span class="badge bg-secondary">Already gated out</span></div>
                    <?php endif; ?>

                    <button class="btn btn-outline-primary btn-sm action-button" data-bs-toggle="modal" data-bs-target="#<?= h($modalId) ?>">View</button>

                    <div class="modal fade" id="<?= h($modalId) ?>" tabindex="-1" aria-hidden="true">
                      <div class="modal-dialog modal-lg"><div class="modal-content">
                        <div class="modal-header"><h5 class="modal-title">Container <?= h($rec['container_no'] ?? '') ?></h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
                        <div class="modal-body">
                          <dl class="row">
                            <dt class="col-4">Container</dt><dd class="col-8"><?= h($rec['container_no'] ?? '') ?></dd>
                            <dt class="col-4">Size</dt><dd class="col-8"><?= h($rec['container_size'] ?? '—') ?></dd>
                            <dt class="col-4">Payment</dt><dd class="col-8"><?= h($rec['payment_id'] ?? '') ?></dd>
                            <dt class="col-4">Receipt</dt><dd class="col-8"><?= h($rec['receipt_no'] ?? '') ?></dd>
                            <dt class="col-4">Consignee</dt><dd class="col-8"><?= h($rec['consignee'] ?? '') ?></dd>
                            <dt class="col-4">Scanned</dt><dd class="col-8"><?= !empty($rec['is_scanned']) ? 'Yes' : 'No' ?></dd>
                            <dt class="col-4">Exited</dt><dd class="col-8"><?= !empty($rec['is_exited']) ? 'Yes' : 'No' ?></dd>
                          </dl>
                        </div>
                      </div></div>
                    </div>
                </div></div>
            <?php endif; ?>
        <?php endforeach; ?>
    <?php elseif (!empty($_GET)): ?>
        <div class="alert alert-info">No results found for your search.</div>
    <?php endif; ?>

</div>

<!-- Report Modal (lazy loaded, paginated) -->
<div class="modal fade report-modal" id="reportModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
    <div class="modal-content">
      <div class="modal-header">
        <div class="neon-dot"></div>
        <h5 class="modal-title ms-2">Generate Report <small class="text-muted ms-2">date/time filters + PDF export</small></h5>
        <div class="ms-auto">
            <button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal"><i class="fas fa-times"></i> Close</button>
        </div>
      </div>

      <div class="modal-body">
        <form id="modalFilterForm" method="post" class="row g-2 mb-3">
            <input type="hidden" name="action" value="generate_pdf">
            <input type="hidden" name="vehicle_no" value="<?= h($vehicle_no) ?>">
            <input type="hidden" name="container_no" value="<?= h($container_no) ?>">
            <input type="hidden" name="chassis_no" value="<?= h($chassis_no) ?>">

            <div class="col-md-3">
                <label class="form-label small mb-0">From date</label>
                <input name="date_from" type="date" class="form-control" value="">
            </div>
            <div class="col-md-3">
                <label class="form-label small mb-0">To date</label>
                <input name="date_to" type="date" class="form-control" value="">
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-0">From time</label>
                <input name="time_from" type="time" class="form-control" value="">
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-0">To time</label>
                <input name="time_to" type="time" class="form-control" value="">
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-0">Status</label>
                <select name="modal_status" class="form-select">
                    <option value="exited" selected>Exited</option>
                    <option value="all">All</option>
                    <option value="not_exited">Not Exited</option>
                </select>
            </div>

            <div class="col-12 mt-2 d-flex gap-2">
                <button type="button" id="modalFilterBtn" class="btn btn-primary"><i class="fas fa-filter"></i> Filter</button>
                <button type="button" id="modalClearBtn" class="btn btn-outline-secondary"><i class="fas fa-broom"></i> Clear Filter</button>
                <button type="button" id="modalPreviewBtn" class="btn btn-outline-info"><i class="fas fa-eye"></i> Preview</button>
                <button type="submit" class="btn btn-success ms-auto"><i class="fas fa-download"></i> Download PDF</button>
            </div>
        </form>

        <div id="modalLoading" class="text-center py-4" style="display:none;">
            <div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div>
            <div class="mt-2 small text-muted">Loading records...</div>
        </div>

        <div id="modalRecords" class="mt-3">
            <table class="responsive-table w-100">
                <thead>
                    <tr>
                        <th>Source</th>
                        <th>Appointment / Consignee</th>
                        <th>Container</th>
                        <th>Size</th>
                        <th>Vehicle</th>
                        <th>Scanned</th>
                        <th>Exited</th>
                        <th>Action Date</th>
                        <th>Fee</th>
                        <th>Receipt Number</th>
                        <th>SAD Number</th>
                        <th>Consignee (Vehicle)</th>
                        <th>Status</th>
                        <th>Payment/Receipt</th>
                    </tr>
                </thead>
                <tbody id="modalRecordsBody">
                    <tr><td colspan="14" class="text-center p-3 text-muted">Open the modal (Generate Report) to load exited records (paginated).</td></tr>
                </tbody>
            </table>
        </div>

        <div class="d-flex justify-content-between align-items-center mt-3">
            <div class="small-muted">Showing <span id="modalCountInfo">0</span> rows</div>
            <div>
                <button id="modalPrevBtn" class="btn btn-outline-secondary btn-sm me-2" disabled>Prev</button>
                <span id="modalPageInfo" class="small-muted">Page 0 / 0</span>
                <button id="modalNextBtn" class="btn btn-outline-secondary btn-sm ms-2" disabled>Next</button>
            </div>
        </div>

      </div>
      <div class="modal-footer">
        <small class="text-muted">Pro-tip: pick a date/time range & status then click Download PDF to get a professional export. Modal content is lazy-loaded for speed and paged to avoid timeouts.</small>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
(function(){
    // helper: escape html
    function h(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, function(m){
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
        });
    }
    // parse "YYYY-MM-DD HH:ii:ss" or "YYYY-MM-DD"
    function parseDateTime(s) {
        if (!s) return null;
        var t = s.replace(' ', 'T');
        var d = new Date(t);
        if (!isNaN(d.getTime())) return d;
        return null;
    }

    // Build table row for an item
    function buildRowHtml(item) {
        var source = item.source || '';
        var apInfo = '';
        if (item.appointment_id) {
            apInfo = 'Appointment #' + (item.appointment_id || '') + (item.container_consignee ? ' — '+item.container_consignee : '');
        } else {
            apInfo = (item.container_consignee || '') || '';
        }
        var containerCell = item.container_no ? ('<span class="container-badge">'+h(item.container_no)+'</span>') : '';
        var sizeCell = item.container_size ? ('<span class="size-badge">'+h(item.container_size)+'</span>') : '';
        var vehicle = item.vehicle_model || item.vehicle_chassis_no || '';
        var scanned = item.action_at || item.appointment_date ? (item.container_size ? 'Yes' : 'Yes') : 'No';
        var exited = item.is_exited ? 'Yes' : 'No';
        var actionAt = item.action_at || item.appointment_date || '';
        var fee = item.vehicle_fee ? h(item.vehicle_fee) : '';
        var v_receipt = item.vehicle_receipt_no ? h(item.vehicle_receipt_no) : '';
        var v_sad = item.vehicle_sad_number ? h(item.vehicle_sad_number) : '';
        var v_consignee = item.vehicle_consignee_name ? h(item.vehicle_consignee_name) : '';
        var status = item.exit_status ? h(item.exit_status) : '';
        var pay = (item.payment_id || '') + ' / ' + (item.receipt_no || '');
        var html = '<tr class="modal-row" data-action-at="'+h(actionAt)+'" data-exited="'+(item.is_exited ? '1' : '0')+'">'
                 + '<td>' + h(source) + '</td>'
                 + '<td>' + h(apInfo) + '</td>'
                 + '<td>' + containerCell + '</td>'
                 + '<td>' + sizeCell + '</td>'
                 + '<td>' + h(item.vehicle_model || item.vehicle_chassis_no || '') + '</td>'
                 + '<td>' + h(scanned) + '</td>'
                 + '<td>' + h(exited) + '</td>'
                 + '<td>' + h(actionAt) + '</td>'
                 + '<td>' + fee + '</td>'
                 + '<td>' + v_receipt + '</td>'
                 + '<td>' + v_sad + '</td>'
                 + '<td>' + v_consignee + '</td>'
                 + '<td>' + status + '</td>'
                 + '<td>' + h(pay) + '</td>'
                 + '</tr>';
        return html;
    }

    // fetch modal page
    var currentPage = 1;
    var totalPages = 0;
    var perPage = 100; // default per page (tunable)
    var fetchedOnce = false;

    function setPagingControls() {
        document.getElementById('modalPrevBtn').disabled = (currentPage <= 1);
        document.getElementById('modalNextBtn').disabled = (currentPage >= totalPages);
        document.getElementById('modalPageInfo').innerText = 'Page ' + currentPage + ' / ' + totalPages;
    }

    function updateCountInfo(count) {
        document.getElementById('modalCountInfo').innerText = count;
    }

    function fetchModalPage(page) {
        page = Math.max(1, page || 1);
        currentPage = page;
        var loading = document.getElementById('modalLoading');
        var body = document.getElementById('modalRecordsBody');
        var pageInfo = document.getElementById('modalPageInfo');
        loading.style.display = '';
        body.innerHTML = '';
        // include current top-level search params so server can narrow results
        var params = new URLSearchParams();
        params.append('action', 'fetch_modal_records');
        params.append('page', page);
        params.append('per_page', perPage);
        var veh = document.querySelector('input[name="vehicle_no"]')?.value || '';
        var cont = document.querySelector('input[name="container_no"]')?.value || '';
        var ch = document.querySelector('input[name="chassis_no"]')?.value || '';
        if (veh) params.append('vehicle_no', veh);
        if (cont) params.append('container_no', cont);
        if (ch) params.append('chassis_no', ch);

        fetch(window.location.pathname + '?' + params.toString(), { credentials: 'same-origin' })
            .then(function(res){ if (!res.ok) throw new Error('Server error: '+res.status); return res.json(); })
            .then(function(json){
                loading.style.display = 'none';
                if (json.error) {
                    body.innerHTML = '<tr><td colspan="14" class="text-center text-danger p-3">' + h(json.error) + '</td></tr>';
                    return;
                }
                totalPages = json.total_pages || 0;
                currentPage = json.page || 1;
                var items = json.items || [];
                if (!items.length) {
                    body.innerHTML = '<tr><td colspan="14" class="text-center p-3">No records found.</td></tr>';
                } else {
                    var html = '';
                    items.forEach(function(it){ html += buildRowHtml(it); });
                    body.innerHTML = html;
                }
                setPagingControls();
                updateCountInfo(json.total || items.length);
            })
            .catch(function(err){
                loading.style.display = 'none';
                body.innerHTML = '<tr><td colspan="14" class="text-center text-danger p-3">Error loading records: ' + h(err.message) + '</td></tr>';
            });
    }

    // open modal: lazy load first page
    var openBtn = document.getElementById('openReportBtn');
    openBtn?.addEventListener('click', function(){
        // load first page on first open
        if (!fetchedOnce) {
            fetchedOnce = true;
            fetchModalPage(1);
        }
    });

    // prev / next handlers
    document.getElementById('modalPrevBtn')?.addEventListener('click', function(e){
        e.preventDefault();
        if (currentPage > 1) fetchModalPage(currentPage - 1);
    });
    document.getElementById('modalNextBtn')?.addEventListener('click', function(e){
        e.preventDefault();
        if (currentPage < totalPages) fetchModalPage(currentPage + 1);
    });

    // Filter & Clear & Preview client-side
    document.getElementById('modalFilterBtn')?.addEventListener('click', function(e){
        e.preventDefault();
        // simply reapply client-side filters on currently loaded rows (faster than server)
        applyModalFilters(true);
    });
    document.getElementById('modalClearBtn')?.addEventListener('click', function(e){
        e.preventDefault();
        var form = document.getElementById('modalFilterForm');
        form.querySelector('[name=date_from]').value = '';
        form.querySelector('[name=date_to]').value = '';
        form.querySelector('[name=time_from]').value = '';
        form.querySelector('[name=time_to]').value = '';
        form.querySelector('[name=modal_status]').value = 'exited';
        document.querySelectorAll('#modalRecordsBody tr.modal-row').forEach(function(tr){ tr.style.display = ''; });
        var prev = document.querySelector('#reportModal .modal-body .alert.alert-info');
        if (prev) prev.remove();
    });
    document.getElementById('modalPreviewBtn')?.addEventListener('click', function(e){
        e.preventDefault();
        applyModalFilters(true);
    });

    function applyModalFilters(showMessage) {
        var form = document.getElementById('modalFilterForm');
        var df = form.querySelector('[name=date_from]').value;
        var dt = form.querySelector('[name=date_to]').value;
        var tf = form.querySelector('[name=time_from]').value;
        var tt = form.querySelector('[name=time_to]').value;
        var status = form.querySelector('[name=modal_status]').value;

        var rows = document.querySelectorAll('#modalRecordsBody tr.modal-row');
        var visibleCount = 0;
        var start = null, end = null;
        if (df) {
            start = new Date(df + 'T' + (tf || '00:00') + ':00');
        }
        if (dt) {
            end = new Date(dt + 'T' + (tt || '23:59') + ':59');
        }

        rows.forEach(function(tr){
            var actionAt = tr.dataset.actionAt || '';
            var exited = tr.dataset.exited === '1';
            var show = true;

            if (status === 'exited' && !exited) show = false;
            if (status === 'not_exited' && exited) show = false;

            if (show && (start || end)) {
                if (!actionAt) {
                    // if there is no action_at (vehicle_details), treat as no match for date filters
                    show = false;
                } else {
                    var dtObj = parseDateTime(actionAt);
                    if (!dtObj) { show = false; }
                    else {
                        if (start && dtObj < start) show = false;
                        if (end && dtObj > end) show = false;
                    }
                }
            }

            if (show) {
                tr.style.display = '';
                visibleCount++;
            } else {
                tr.style.display = 'none';
            }
        });

        if (showMessage) {
            var alert = document.createElement('div');
            alert.className = 'alert alert-info';
            alert.innerText = 'Filtered results (client-side): ' + visibleCount + ' row(s).';
            var modalBody = document.querySelector('#reportModal .modal-body');
            var prev = document.querySelector('#reportModal .modal-body .alert.alert-info');
            if (prev) prev.remove();
            modalBody.insertBefore(alert, modalBody.firstChild);
            setTimeout(function(){ if (alert) alert.remove(); }, 4200);
        }
    }

    // Clear preview alerts when modal shows
    var reportModal = document.getElementById('reportModal');
    reportModal?.addEventListener('show.bs.modal', function (event) {
        var prev = document.querySelector('#reportModal .modal-body .alert.alert-info');
        if (prev) prev.remove();
    });

})();
</script>
</body>
</html>
