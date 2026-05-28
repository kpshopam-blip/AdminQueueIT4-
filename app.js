/**
 * ระบบจัดการคิว Admin ประจำวัน (Daily Admin Queue System - Frontend Logic)
 * เวอร์ชัน Supabase v2: รองรับเลือกร้านค้าเมื่อรับเคส + ปุ่มยกเลิกเคส
 */

// ==========================================================================
// ข้อมูลเชื่อมต่อ Supabase
// ==========================================================================
const SUPABASE_URL = "https://tnlmxsljwajvaboxdjqj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubG14c2xqd2FqdmFib3hkanFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Mzg1OTgsImV4cCI6MjA5NTUxNDU5OH0.l9VmRa4HyTqhNyB-itnLS5JeSNVv8JEJSVoPu1s-FNU";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ตัวแปรเก็บข้อมูลภายในแอป (State)
let appState = {
  queueList: [],
  activeList: [],
  offlineList: [],
  selectedAdmin: null,
  activeTimerInterval: null,
  activeAdminStartTime: null,
  shops: [] // รายชื่อร้านค้าทั้งหมดจาก Supabase
};

// อ้างอิงอิลิเมนต์ใน HTML (DOM Elements)
const dom = {
  loadingOverlay: document.getElementById('loading-overlay'),
  adminSelect: document.getElementById('admin-select'),
  currentUserInfo: document.getElementById('current-user-info'),
  myStatusBadge: document.getElementById('my-status-badge'),
  noAdminsWarning: document.getElementById('no-admins-warning'),
  activeAdminName: document.getElementById('active-admin-name'),
  activeTimer: document.getElementById('active-timer'),
  timerText: document.getElementById('timer-text'),
  activeShopInfo: document.getElementById('active-shop-info'),
  activeShopText: document.getElementById('active-shop-text'),
  nextAdminName: document.getElementById('next-admin-name'),
  nextAdminSub: document.getElementById('next-admin-sub'),
  actionPanel: document.getElementById('action-panel'),
  actionUserName: document.getElementById('action-user-name'),
  btnCheckin: document.getElementById('btn-checkin'),
  btnCheckout: document.getElementById('btn-checkout'),
  btnAccept: document.getElementById('btn-accept'),
  btnPass: document.getElementById('btn-pass'),
  btnComplete: document.getElementById('btn-complete'),
  btnCancel: document.getElementById('btn-cancel'),
  queueTableBody: document.getElementById('queue-table-body'),
  totalCasesToday: document.getElementById('total-cases-today'),
  totalAdminsActive: document.getElementById('total-admins-active'),
  adminsStatsList: document.getElementById('admins-stats-list'),
  btnManualReset: document.getElementById('btn-manual-reset'),
  syncStatus: document.getElementById('sync-status')
};

// ==========================================================================
// การเริ่มต้นระบบ (Initialization)
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupMobileProtection();

  const savedAdmin = localStorage.getItem('selectedAdmin');
  if (savedAdmin) {
    appState.selectedAdmin = savedAdmin;
  }

  // โหลดข้อมูลร้านค้าล่วงหน้า
  fetchShops();

  checkDailyReset().then(() => {
    fetchDataFromSupabase(true);
  });

  setupRealtimeSubscription();
});

function setupEventListeners() {
  dom.adminSelect.addEventListener('change', (e) => {
    const selected = e.target.value;
    appState.selectedAdmin = selected;
    localStorage.setItem('selectedAdmin', selected);
    updateUI();
  });

  dom.btnCheckin.addEventListener('click', () => executeAction('checkIn'));

  dom.btnCheckout.addEventListener('click', async () => {
    const isConfirm = await showCustomConfirm(
      'คุณต้องการลงชื่อออกงาน (Check-Out) และถอนรายชื่อออกจากลำดับคิวใช่หรือไม่?',
      'ยืนยันการ Check-Out',
      'modal-icon-danger',
      'fa-right-from-bracket'
    );
    if (isConfirm) executeAction('checkOut');
  });

  // ปุ่มรับเคส: เปิด Shop Selector ก่อน แล้วค่อยรับเคสพร้อมข้อมูลร้าน
  dom.btnAccept.addEventListener('click', async () => {
    const selectedShop = await showShopSelector();
    if (selectedShop) {
      executeAction('acceptCase', selectedShop);
    }
  });

  dom.btnPass.addEventListener('click', async () => {
    const isConfirm = await showCustomConfirm(
      'คุณต้องการข้ามคิวของคุณและส่งรายชื่อไปต่อท้ายสุดของคิวใช่หรือไม่?',
      'ยืนยันการข้ามคิว',
      'modal-icon-warning',
      'fa-forward'
    );
    if (isConfirm) executeAction('passQueue');
  });

  dom.btnComplete.addEventListener('click', async () => {
    const isConfirm = await showCustomConfirm(
      'คุณแน่ใจว่าต้องการจบเคสนี้แล้วใช่ไหม?\n(เวลาจะถูกนำไปบันทึกสถิติลงฐานข้อมูล)',
      'ยืนยันการจบเคส',
      'modal-icon-success',
      'fa-circle-stop'
    );
    if (isConfirm) executeAction('completeCase');
  });

  // ปุ่มยกเลิกเคส (กดผิด)
  dom.btnCancel.addEventListener('click', async () => {
    const isConfirm = await showCustomConfirm(
      'คุณต้องการยกเลิกเคสนี้ใช่ไหม?\n(คุณจะถูกย้ายกลับไปเป็นคิวที่ 1)',
      'ยืนยันการยกเลิกเคส',
      'modal-icon-warning',
      'fa-xmark'
    );
    if (isConfirm) executeAction('cancelCase');
  });

  dom.btnManualReset.addEventListener('click', async () => {
    const password = await showCustomPrompt(
      'กรุณาพิมพ์คำว่า "RESET" (ตัวพิมพ์ใหญ่ทั้งหมด)\nเพื่อยืนยันการล้างข้อมูลคิวและยอดเคสสะสมของวันนี้:',
      'ยืนยันการรีเซ็ตระบบคิว',
      'พิมพ์คำว่า RESET'
    );
    if (password === 'RESET') {
      executeAction('resetAll');
    } else if (password !== null) {
      await showCustomAlert('รหัสความปลอดภัยไม่ถูกต้อง ไม่สามารถดำเนินการได้', 'ข้อผิดพลาด', 'modal-icon-danger', 'fa-triangle-exclamation');
    }
  });
}

// ==========================================================================
// Realtime Subscription
// ==========================================================================
function setupRealtimeSubscription() {
  db.channel('queue-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'admin_queue' },
      (payload) => {
        console.log('📡 Realtime update:', payload.eventType);
        fetchDataFromSupabase(false);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime subscription active');
        dom.syncStatus.querySelector('.status-text').textContent = "เชื่อมต่อเรียลไทม์";
        dom.syncStatus.querySelector('.dot').classList.add('pulse');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Realtime subscription error');
        dom.syncStatus.querySelector('.status-text').textContent = "Realtime ขัดข้อง";
        dom.syncStatus.querySelector('.dot').classList.remove('pulse');
      }
    });
}

// ==========================================================================
// การดึงข้อมูลจาก Supabase
// ==========================================================================
async function fetchDataFromSupabase(showLoader = false) {
  if (showLoader) showLoading(true);
  dom.syncStatus.querySelector('.status-text').textContent = "กำลังอัปเดต...";

  try {
    const { data, error } = await db.from('admin_queue').select('*');

    if (error) {
      console.error('Supabase Error:', error);
      dom.syncStatus.querySelector('.status-text').textContent = "เชื่อมต่อล้มเหลว";
      return;
    }

    const mapped = (data || []).map(row => ({
      name: row.name,
      status: row.status || 'Offline',
      queueNum: row.queue_num != null ? parseInt(row.queue_num) : null,
      checkInTime: row.check_in_time,
      completedCases: row.completed_cases || 0,
      lastActionTime: row.last_action_time,
      currentShopCode: row.current_shop_code || null,
      currentShopName: row.current_shop_name || null
    }));

    appState.queueList = mapped
      .filter(a => a.status === 'Waiting' || a.status === 'Passed')
      .sort((a, b) => (a.queueNum || 999) - (b.queueNum || 999));
    appState.activeList = mapped.filter(a => a.status === 'Active');
    appState.offlineList = mapped.filter(a => a.status === 'Offline');

    populateAdminSelect();
    updateUI();
  } catch (err) {
    console.error('Fetch error:', err);
    dom.syncStatus.querySelector('.status-text').textContent = "เชื่อมต่อล้มเหลว";
  } finally {
    if (showLoader) showLoading(false);
    setTimeout(() => {
      dom.syncStatus.querySelector('.status-text').textContent = "เชื่อมต่อเรียลไทม์";
    }, 2000);
  }
}

/**
 * ดึงรายชื่อร้านค้าจาก Supabase
 */
async function fetchShops() {
  try {
    const { data, error } = await db
      .from('shops')
      .select('*')
      .order('shop_code', { ascending: true });

    if (error) {
      console.error('Error fetching shops:', error);
      return;
    }
    appState.shops = data || [];
    console.log('🏪 โหลดร้านค้า ' + appState.shops.length + ' ร้าน');
  } catch (err) {
    console.error('Error fetching shops:', err);
  }
}

// ==========================================================================
// การจัดการคำสั่ง (Action Handling)
// ==========================================================================
async function executeAction(actionName, extraData = null) {
  showLoading(true);

  try {
    let result;
    switch (actionName) {
      case 'checkIn':
        result = await dbCheckIn(appState.selectedAdmin);
        break;
      case 'checkOut':
        result = await dbCheckOut(appState.selectedAdmin);
        break;
      case 'acceptCase':
        result = await dbAcceptCase(appState.selectedAdmin, extraData);
        break;
      case 'completeCase':
        result = await dbCompleteCase(appState.selectedAdmin);
        break;
      case 'passQueue':
        result = await dbPassQueue(appState.selectedAdmin);
        break;
      case 'cancelCase':
        result = await dbCancelCase(appState.selectedAdmin);
        break;
      case 'resetAll':
        result = await dbResetAll();
        break;
      default:
        result = { success: false, message: 'คำสั่งไม่ถูกต้อง' };
    }

    if (result.success) {
      if (result.message) {
        await showCustomAlert(result.message, 'ดำเนินการสำเร็จ', 'modal-icon-success', 'fa-circle-check');
      }
      await fetchDataFromSupabase(false);
    } else {
      await showCustomAlert('เกิดข้อผิดพลาด: ' + (result.message || 'ไม่ทราบสาเหตุ'), 'เกิดข้อผิดพลาด', 'modal-icon-danger', 'fa-triangle-exclamation');
    }
  } catch (error) {
    console.error('Error executing action:', error);
    await showCustomAlert('เกิดข้อผิดพลาดที่ไม่คาดคิด: ' + error.message, 'เกิดข้อผิดพลาด', 'modal-icon-danger', 'fa-triangle-exclamation');
  } finally {
    showLoading(false);
  }
}

// ==========================================================================
// Database Operations
// ==========================================================================

async function dbCheckIn(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  const { data: adminData, error: fetchErr } = await db
    .from('admin_queue').select('status').eq('name', adminName).single();

  if (fetchErr && fetchErr.code !== 'PGRST116') return { success: false, message: fetchErr.message };

  if (adminData && (adminData.status === 'Waiting' || adminData.status === 'Active' || adminData.status === 'Passed')) {
    return { success: true, message: adminName + ' ลงชื่อเข้างานอยู่แล้ว' };
  }

  const { data: queueData } = await db.from('admin_queue').select('queue_num').or('status.eq.Waiting,status.eq.Passed');
  const maxQueueNum = queueData && queueData.length > 0 ? Math.max(...queueData.map(d => d.queue_num || 0)) : 0;
  const nextQueueNum = maxQueueNum + 1;
  const now = new Date().toISOString();

  if (adminData) {
    const { error } = await db.from('admin_queue').update({
      status: 'Waiting', queue_num: nextQueueNum, check_in_time: now, last_action_time: now
    }).eq('name', adminName);
    if (error) return { success: false, message: error.message };
  } else {
    const { error } = await db.from('admin_queue').insert({
      name: adminName, status: 'Waiting', queue_num: nextQueueNum, check_in_time: now, completed_cases: 0, last_action_time: now
    });
    if (error) return { success: false, message: error.message };
  }

  return { success: true, message: adminName + ' ลงชื่อเข้างานเป็นคิวที่ ' + nextQueueNum };
}

async function dbCheckOut(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  const { data: adminData } = await db.from('admin_queue').select('queue_num').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  const checkoutQueueNum = adminData.queue_num;
  const now = new Date().toISOString();

  const { error } = await db.from('admin_queue').update({
    status: 'Offline', queue_num: null, last_action_time: now
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  if (checkoutQueueNum != null) await reorderQueues(checkoutQueueNum);

  return { success: true, message: adminName + ' ลงชื่อออกงานเรียบร้อยแล้ว' };
}

/**
 * กดรับเคส — ต้องเลือกร้านค้าก่อน
 * @param {string} adminName
 * @param {object} shopData - { shop_code, shop_name }
 */
async function dbAcceptCase(adminName, shopData) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };
  if (!shopData) return { success: false, message: 'กรุณาเลือกร้านค้า' };

  const { data: adminData } = await db.from('admin_queue').select('queue_num').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  if (adminData.queue_num !== 1) {
    return { success: false, message: 'ยังไม่ถึงคิวของคุณ (ปัจจุบันคุณเป็นคิวที่ ' + adminData.queue_num + ')' };
  }

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  // บันทึกเวลาเริ่มทำเคสพร้อมข้อมูลร้านค้า
  const { error: logError } = await db.from('case_logs').insert({
    admin_name: adminName,
    start_time: now,
    date: todayDate,
    shop_code: shopData.shop_code,
    shop_name: shopData.shop_name
  });
  if (logError) console.error('Error logging case:', logError);

  // อัปเดตสถานะเป็น Active พร้อมข้อมูลร้านค้า
  const { error } = await db.from('admin_queue').update({
    status: 'Active',
    queue_num: null,
    last_action_time: now,
    current_shop_code: shopData.shop_code,
    current_shop_name: shopData.shop_name
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  await reorderQueues(1);

  return { success: true, message: adminName + ' เริ่มรับเคส — ร้าน: ' + shopData.shop_name };
}

async function dbCompleteCase(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  const { data: adminData } = await db.from('admin_queue').select('completed_cases').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  const now = new Date().toISOString();

  const { data: logData } = await db.from('case_logs')
    .select('log_id, start_time').eq('admin_name', adminName)
    .is('end_time', null).order('start_time', { ascending: false }).limit(1);

  let durationSeconds = 0;
  if (logData && logData.length > 0) {
    const startTime = new Date(logData[0].start_time);
    durationSeconds = Math.round((new Date(now).getTime() - startTime.getTime()) / 1000);
    await db.from('case_logs').update({ end_time: now, duration_seconds: durationSeconds }).eq('log_id', logData[0].log_id);
  }

  const { data: queueData } = await db.from('admin_queue').select('queue_num').or('status.eq.Waiting,status.eq.Passed');
  const maxQueueNum = queueData && queueData.length > 0 ? Math.max(...queueData.map(d => d.queue_num || 0)) : 0;
  const nextQueueNum = maxQueueNum + 1;

  const { error } = await db.from('admin_queue').update({
    status: 'Waiting', queue_num: nextQueueNum, check_in_time: now,
    completed_cases: (adminData.completed_cases || 0) + 1,
    last_action_time: now,
    current_shop_code: null, current_shop_name: null
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  return {
    success: true,
    message: adminName + ' จบเคสเรียบร้อยแล้ว ใช้เวลา ' + formatDurationText(durationSeconds)
  };
}

async function dbPassQueue(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  const { data: adminData } = await db.from('admin_queue').select('queue_num').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  if (adminData.queue_num !== 1) {
    return { success: false, message: 'ไม่สามารถกดข้ามคิวได้เนื่องจากคุณไม่ใช่คิวปัจจุบัน' };
  }

  const now = new Date().toISOString();
  const { data: queueData } = await db.from('admin_queue').select('queue_num').or('status.eq.Waiting,status.eq.Passed');
  const totalWaiting = queueData ? queueData.length : 1;

  const { error } = await db.from('admin_queue').update({
    status: 'Passed', queue_num: totalWaiting, last_action_time: now
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  await reorderQueues(1);

  const { data: updatedQueue } = await db.from('admin_queue').select('name').or('status.eq.Waiting,status.eq.Passed');
  const waitingCount = updatedQueue ? updatedQueue.length : 1;
  await db.from('admin_queue').update({ queue_num: waitingCount }).eq('name', adminName);

  return { success: true, message: adminName + ' กดข้ามคิวและขยับไปอยู่ลำดับสุดท้าย' };
}

/**
 * ยกเลิกเคส (กดรับผิด) — ย้ายแอดมินกลับไปเป็นคิวที่ 1
 */
async function dbCancelCase(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  // ใช้ RPC function
  const { error } = await db.rpc('cancel_active_case', { admin_name_param: adminName });

  if (error) {
    // fallback: ทำด้วยตัวเอง
    console.warn('RPC cancel_active_case failed, using fallback:', error);

    // ขยับคิวทุกคนลงไป 1
    const { data: waitingAdmins } = await db.from('admin_queue')
      .select('name, queue_num')
      .or('status.eq.Waiting,status.eq.Passed')
      .not('queue_num', 'is', null);

    if (waitingAdmins) {
      for (const admin of waitingAdmins) {
        await db.from('admin_queue').update({ queue_num: admin.queue_num + 1 }).eq('name', admin.name);
      }
    }

    // ตั้งค่าแอดมินกลับเป็น Waiting ที่คิว 1
    const now = new Date().toISOString();
    await db.from('admin_queue').update({
      status: 'Waiting', queue_num: 1,
      current_shop_code: null, current_shop_name: null,
      last_action_time: now
    }).eq('name', adminName);

    // ลบ case log ที่ยังไม่จบ
    await db.from('case_logs').delete().eq('admin_name', adminName).is('end_time', null);
  }

  return { success: true, message: adminName + ' ยกเลิกเคสเรียบร้อย ย้ายกลับเป็นคิวที่ 1' };
}

async function dbResetAll() {
  const { error } = await db.rpc('reset_all_queues');
  if (error) {
    console.warn('RPC reset_all_queues failed, using fallback:', error);
    const { data: allAdmins } = await db.from('admin_queue').select('name');
    if (allAdmins) {
      const now = new Date().toISOString();
      for (const admin of allAdmins) {
        await db.from('admin_queue').update({
          status: 'Offline', queue_num: null, check_in_time: null, completed_cases: 0,
          last_action_time: now, current_shop_code: null, current_shop_name: null
        }).eq('name', admin.name);
      }
    }
  }
  return { success: true, message: 'รีเซ็ตคิวและเคสสะสมประจำวันเรียบร้อยแล้ว' };
}

async function reorderQueues(deletedQueueNum) {
  const { error } = await db.rpc('reorder_queues', { deleted_queue_num: deletedQueueNum });
  if (error) {
    console.warn('RPC reorder_queues failed, using fallback:', error);
    const { data } = await db.from('admin_queue')
      .select('name, queue_num').or('status.eq.Waiting,status.eq.Passed')
      .gt('queue_num', deletedQueueNum);
    if (data) {
      for (const row of data) {
        await db.from('admin_queue').update({ queue_num: row.queue_num - 1 }).eq('name', row.name);
      }
    }
  }
}

async function checkDailyReset() {
  try {
    const { data, error } = await db.from('admin_queue')
      .select('last_action_time').not('last_action_time', 'is', null).limit(1).maybeSingle();

    if (error) {
      console.warn('Daily reset check failed or table is empty:', error);
      return;
    }

    if (data && data.last_action_time) {
      const lastDate = new Date(data.last_action_time);
      const today = new Date();
      const lastDateStr = lastDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      if (lastDateStr !== todayStr) {
        console.log('🔄 ข้ามวันใหม่ — กำลังรีเซ็ตระบบอัตโนมัติ...');
        await dbResetAll();
      }
    }
  } catch (err) {
    console.warn('Daily reset check failed:', err);
  }
}

// ==========================================================================
// UI Rendering
// ==========================================================================
function updateUI() {
  updateSelectedUserStatus();

  const allWorkingAdmins = [...appState.queueList, ...appState.activeList];
  dom.noAdminsWarning.style.display = allWorkingAdmins.length === 0 ? 'flex' : 'none';

  updateActiveCard();
  updateNextQueueCard();
  updateActionPanel();
  renderQueueTable();
  renderSummaryDashboard();
}

function populateAdminSelect() {
  const allAdmins = [];
  [...appState.queueList, ...appState.activeList, ...appState.offlineList].forEach(a => {
    if (a.name && !allAdmins.includes(a.name)) allAdmins.push(a.name);
  });
  allAdmins.sort((a, b) => a.localeCompare(b, 'th'));

  const previousValue = dom.adminSelect.value || appState.selectedAdmin;
  dom.adminSelect.innerHTML = '<option value="" disabled selected>-- เลือกชื่อของคุณ --</option>';
  allAdmins.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    dom.adminSelect.appendChild(option);
  });
  if (allAdmins.includes(previousValue)) {
    dom.adminSelect.value = previousValue;
    appState.selectedAdmin = previousValue;
  }
}

function updateSelectedUserStatus() {
  if (appState.selectedAdmin) {
    dom.currentUserInfo.style.display = 'flex';
    const currentAdminData = findAdminData(appState.selectedAdmin);
    const status = (currentAdminData && currentAdminData.status) ? currentAdminData.status : "Offline";
    dom.myStatusBadge.textContent = translateStatus(status);
    dom.myStatusBadge.className = 'status-badge ' + getStatusBadgeClass(status);
  } else {
    dom.currentUserInfo.style.display = 'none';
  }
}

function updateActiveCard() {
  clearInterval(appState.activeTimerInterval);

  if (appState.activeList.length > 0) {
    const activeAdmin = appState.activeList[0];
    dom.activeAdminName.textContent = activeAdmin.name;
    dom.activeTimer.style.display = 'inline-flex';

    // แสดงชื่อร้านค้าที่กำลังรับเคส
    if (activeAdmin.currentShopName) {
      dom.activeShopInfo.style.display = 'inline-flex';
      dom.activeShopText.textContent = activeAdmin.currentShopName;
    } else {
      dom.activeShopInfo.style.display = 'none';
    }

    if (activeAdmin.lastActionTime) {
      const startTime = new Date(activeAdmin.lastActionTime);
      appState.activeAdminStartTime = startTime;
      runLiveTimer();
      appState.activeTimerInterval = setInterval(runLiveTimer, 1000);
    } else {
      dom.timerText.textContent = "00:00";
    }
  } else {
    dom.activeAdminName.textContent = "- ไม่มีแอดมินรับเคส -";
    dom.activeTimer.style.display = 'none';
    dom.activeShopInfo.style.display = 'none';
    dom.timerText.textContent = "00:00";
  }
}

function runLiveTimer() {
  if (!appState.activeAdminStartTime) return;
  const now = new Date();
  const diffMs = now.getTime() - appState.activeAdminStartTime.getTime();
  if (diffMs < 0) { dom.timerText.textContent = "00:00"; return; }
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (num) => String(num).padStart(2, '0');
  dom.timerText.textContent = `${pad(minutes)}:${pad(seconds)}`;
}

function updateNextQueueCard() {
  if (appState.queueList.length > 0) {
    const nextAdmin = appState.queueList[0];
    dom.nextAdminName.textContent = nextAdmin.name;
    if (appState.selectedAdmin === nextAdmin.name) {
      dom.nextAdminSub.innerHTML = '<strong style="color:var(--color-waiting);"><i class="fa-solid fa-bell"></i> ถึงคิวของคุณแล้ว! กดรับเคสด้านล่าง</strong>';
    } else {
      dom.nextAdminSub.textContent = "พร้อมสแตนด์บายรับเคสลูกค้าถัดไป";
    }
  } else {
    dom.nextAdminName.textContent = "- ไม่มีคิวรอ -";
    dom.nextAdminSub.textContent = "ไม่มีแอดมินเช็คอินรอคิว";
  }
}

function updateActionPanel() {
  if (!appState.selectedAdmin) { dom.actionPanel.style.display = 'none'; return; }

  dom.actionPanel.style.display = 'block';
  dom.actionUserName.textContent = appState.selectedAdmin;

  const adminData = findAdminData(appState.selectedAdmin);
  const status = (adminData && adminData.status) ? adminData.status : "Offline";
  const queueNum = adminData ? adminData.queueNum : null;

  // ซ่อนปุ่มทั้งหมด
  dom.btnCheckin.style.display = 'none';
  dom.btnCheckout.style.display = 'none';
  dom.btnAccept.style.display = 'none';
  dom.btnPass.style.display = 'none';
  dom.btnComplete.style.display = 'none';
  dom.btnCancel.style.display = 'none';

  if (status === "Offline") {
    dom.btnCheckin.style.display = 'inline-flex';
  } else if (status === "Waiting" || status === "Passed") {
    dom.btnCheckout.style.display = 'inline-flex';
    if (queueNum === 1) {
      dom.btnAccept.style.display = 'inline-flex';
      dom.btnPass.style.display = 'inline-flex';
      dom.btnAccept.classList.add('pulse');
    } else {
      dom.btnAccept.classList.remove('pulse');
    }
  } else if (status === "Active") {
    dom.btnComplete.style.display = 'inline-flex';
    dom.btnCancel.style.display = 'inline-flex'; // แสดงปุ่มยกเลิกเคส
  }
}

function renderQueueTable() {
  dom.queueTableBody.innerHTML = '';
  const tableData = [];

  appState.activeList.forEach(admin => {
    tableData.push({ ...admin, isCurrent: appState.selectedAdmin === admin.name });
  });
  appState.queueList.forEach(admin => {
    tableData.push({ ...admin, isCurrent: appState.selectedAdmin === admin.name });
  });
  appState.offlineList.forEach(admin => {
    tableData.push({ ...admin, isCurrent: appState.selectedAdmin === admin.name });
  });

  if (tableData.length === 0) {
    dom.queueTableBody.innerHTML = '<tr><td colspan="4" class="no-data">ไม่พบรายชื่อในระบบฐานข้อมูล</td></tr>';
    return;
  }

  tableData.forEach(admin => {
    const tr = document.createElement('tr');
    if (admin.isCurrent) tr.className = 'my-row';

    let queueTd = '';
    if (admin.status === "Active") {
      queueTd = '<td style="text-align: center;"><i class="fa-solid fa-headset" style="color:var(--color-active);"></i></td>';
    } else if (admin.queueNum !== null && (admin.status === "Waiting" || admin.status === "Passed")) {
      const isFirst = admin.queueNum === 1;
      queueTd = `<td><span class="queue-badge ${isFirst ? 'first-badge' : ''}">${admin.queueNum}</span></td>`;
    } else {
      queueTd = '<td style="text-align: center; color:var(--text-muted);">-</td>';
    }

    const nameText = admin.isCurrent ? `<strong>${admin.name} (คุณ)</strong>` : admin.name;
    // แสดงชื่อร้านค้าถ้ามีสถานะ Active
    let shopHtml = '';
    if (admin.status === "Active" && admin.currentShopName) {
      shopHtml = `<br><span style="font-size:0.7rem;color:var(--text-muted);"><i class="fa-solid fa-store"></i> ${admin.currentShopName}</span>`;
    }
    const nameTd = `<td>${nameText}${shopHtml}</td>`;

    const statusText = translateStatus(admin.status);
    const statusBadgeClass = getStatusBadgeClass(admin.status);
    const statusTd = `<td><span class="status-badge ${statusBadgeClass}">${statusText}</span></td>`;
    const casesTd = `<td><span class="cases-count">${admin.completedCases || 0}</span></td>`;

    tr.innerHTML = queueTd + nameTd + statusTd + casesTd;
    dom.queueTableBody.appendChild(tr);
  });
}

function renderSummaryDashboard() {
  dom.adminsStatsList.innerHTML = '';
  const allAdmins = [...appState.activeList, ...appState.queueList, ...appState.offlineList];

  let totalCases = 0;
  let activeAdminsCount = 0;
  allAdmins.forEach(admin => {
    totalCases += admin.completedCases || 0;
    if ((admin.status || "Offline") !== "Offline") activeAdminsCount++;
  });

  dom.totalCasesToday.textContent = totalCases;
  dom.totalAdminsActive.textContent = activeAdminsCount;

  const sortedStats = [...allAdmins].sort((a, b) => (b.completedCases || 0) - (a.completedCases || 0));
  sortedStats.forEach(admin => {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'stat-row-name';
    nameSpan.innerHTML = admin.name === appState.selectedAdmin ? `<strong>${admin.name} (คุณ)</strong>` : admin.name;
    const valSpan = document.createElement('span');
    valSpan.className = 'stat-row-val';
    valSpan.textContent = `${admin.completedCases || 0} เคส`;
    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    dom.adminsStatsList.appendChild(row);
  });
}

// ==========================================================================
// Helper Functions
// ==========================================================================
function findAdminData(adminName) {
  let found = appState.activeList.find(a => a.name === adminName);
  if (found) return found;
  found = appState.queueList.find(a => a.name === adminName);
  if (found) return found;
  return appState.offlineList.find(a => a.name === adminName);
}

function translateStatus(status) {
  switch (status) {
    case "Waiting": return "รอคิว";
    case "Active": return "รับงานอยู่";
    case "Passed": return "ข้ามคิว";
    case "Offline": return "Offline";
    default: return status || "Offline";
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case "Waiting": return "status-waiting";
    case "Active": return "status-active";
    case "Passed": return "status-passed";
    case "Offline": return "status-offline";
    default: return "status-offline";
  }
}

function showLoading(isLoading) {
  dom.loadingOverlay.style.opacity = isLoading ? '1' : '0';
  dom.loadingOverlay.style.pointerEvents = isLoading ? 'auto' : 'none';
}

function formatDurationText(totalSeconds) {
  if (totalSeconds < 60) return totalSeconds + " วินาที";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return minutes + " นาที";
  return minutes + " นาที " + seconds + " วินาที";
}

// ==========================================================================
// Mobile Protection
// ==========================================================================
function setupMobileProtection() {
  document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

// ==========================================================================
// Shop Selector Modal (เลือกร้านค้าแบบพิมพ์ค้นหาได้)
// ==========================================================================

/**
 * เปิดกล่องเลือกร้านค้า คืนค่าเป็น Promise<shopObject|null>
 */
function showShopSelector() {
  return new Promise(async (resolve) => {
    // โหลดร้านค้าล่าสุด
    if (appState.shops.length === 0) {
      showLoading(true);
      await fetchShops();
      showLoading(false);
    }

    const modal = document.getElementById('shop-selector-modal');
    const searchInput = document.getElementById('shop-search-input');
    const listContainer = document.getElementById('shop-list-container');
    const cancelBtn = document.getElementById('shop-selector-cancel');

    // แสดงร้านค้าทั้งหมดตั้งแต่เปิดหน้าต่าง
    renderShopList(appState.shops, listContainer, onSelect, cleanup);

    function onSelect(shop) {
      cleanup();
      resolve(shop);
    }

    function handleSearch() {
      const query = searchInput.value.trim().toLowerCase();
      const filtered = query
        ? appState.shops.filter(s =>
            s.shop_name.toLowerCase().includes(query) ||
            s.shop_code.toLowerCase().includes(query)
          )
        : appState.shops;
      renderShopList(filtered, listContainer, onSelect, cleanup);
    }

    function handleCancel() {
      cleanup();
      resolve(null);
    }

    function cleanup() {
      searchInput.removeEventListener('input', handleSearch);
      cancelBtn.removeEventListener('click', handleCancel);
      searchInput.value = '';
      modal.classList.remove('active');
      setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    searchInput.addEventListener('input', handleSearch);
    cancelBtn.addEventListener('click', handleCancel);

    modal.style.display = 'flex';
    setTimeout(() => {
      modal.classList.add('active');
      searchInput.focus();
    }, 10);
  });
}

/**
 * วาดรายการร้านค้าในกล่อง
 */
function renderShopList(shops, container, selectCallback, cleanupCallback) {
  container.innerHTML = '';

  if (shops.length === 0) {
    container.innerHTML = '<p class="shop-list-empty"><i class="fa-solid fa-magnifying-glass"></i> ไม่พบร้านค้าที่ตรงกับคำค้นหา</p>';
    return;
  }

  // แสดงจำนวนร้านที่พบ
  const countEl = document.createElement('div');
  countEl.className = 'shop-match-count';
  countEl.textContent = 'แสดง ' + shops.length + ' ร้าน';
  container.appendChild(countEl);

  shops.forEach(shop => {
    const item = document.createElement('div');
    item.className = 'shop-item';
    item.innerHTML = `
      <span class="shop-name">${shop.shop_name}</span>
      <span class="shop-code">${shop.shop_code}</span>
    `;
    item.addEventListener('click', () => {
      selectCallback(shop);
    });
    container.appendChild(item);
  });
}

// ==========================================================================
// Premium Custom Modal Dialog (Alert, Confirm, Prompt)
// ==========================================================================
function showCustomConfirm(message, title = 'ยืนยันการทำรายการ', iconClass = 'modal-icon-info', iconFa = 'fa-circle-question') {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const iconEl = document.getElementById('modal-icon');
    const inputContainer = document.getElementById('modal-input-container');
    const btnCancel = document.getElementById('modal-btn-cancel');
    const btnConfirm = document.getElementById('modal-btn-confirm');

    titleEl.textContent = title;
    msgEl.innerHTML = message.replace(/\n/g, '<br>');
    iconEl.className = `fa-solid ${iconFa} ${iconClass}`;
    inputContainer.style.display = 'none';
    btnCancel.style.display = 'inline-flex';
    btnConfirm.textContent = 'ตกลง';

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    const handleConfirm = () => { cleanup(true); };
    const handleCancel = () => { cleanup(false); };
    const cleanup = (value) => {
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
      modal.classList.remove('active');
      setTimeout(() => { 
        modal.style.display = 'none'; 
        resolve(value);
      }, 200);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
  });
}

function showCustomAlert(message, title = 'แจ้งเตือนระบบ', iconClass = 'modal-icon-info', iconFa = 'fa-circle-info') {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const iconEl = document.getElementById('modal-icon');
    const inputContainer = document.getElementById('modal-input-container');
    const btnCancel = document.getElementById('modal-btn-cancel');
    const btnConfirm = document.getElementById('modal-btn-confirm');

    titleEl.textContent = title;
    msgEl.innerHTML = message.replace(/\n/g, '<br>');
    iconEl.className = `fa-solid ${iconFa} ${iconClass}`;
    inputContainer.style.display = 'none';
    btnCancel.style.display = 'none';
    btnConfirm.textContent = 'ตกลง';

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    const handleConfirm = () => { cleanup(); };
    const cleanup = () => {
      btnConfirm.removeEventListener('click', handleConfirm);
      modal.classList.remove('active');
      setTimeout(() => { 
        modal.style.display = 'none'; 
        resolve();
      }, 200);
    };

    btnConfirm.addEventListener('click', handleConfirm);
  });
}

function showCustomPrompt(message, title = 'ป้อนข้อมูลเพื่อยืนยัน', placeholder = 'กรอกข้อมูลที่นี่...') {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const iconEl = document.getElementById('modal-icon');
    const inputContainer = document.getElementById('modal-input-container');
    const inputEl = document.getElementById('modal-input');
    const btnCancel = document.getElementById('modal-btn-cancel');
    const btnConfirm = document.getElementById('modal-btn-confirm');

    titleEl.textContent = title;
    msgEl.innerHTML = message.replace(/\n/g, '<br>');
    iconEl.className = 'fa-solid fa-key modal-icon-warning';
    inputContainer.style.display = 'block';
    inputEl.value = '';
    inputEl.placeholder = placeholder;
    btnCancel.style.display = 'inline-flex';
    btnConfirm.textContent = 'ตกลง';

    modal.style.display = 'flex';
    setTimeout(() => { modal.classList.add('active'); inputEl.focus(); }, 10);

    const handleConfirm = () => { const value = inputEl.value; cleanup(value); };
    const handleCancel = () => { cleanup(null); };
    const handleKeyPress = (e) => { if (e.key === 'Enter') handleConfirm(); };
    const cleanup = (value) => {
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
      inputEl.removeEventListener('keypress', handleKeyPress);
      modal.classList.remove('active');
      setTimeout(() => { 
        modal.style.display = 'none'; 
        resolve(value);
      }, 200);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
    inputEl.addEventListener('keypress', handleKeyPress);
  });
}
