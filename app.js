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
  admins: [],       // รายชื่อแอดมินทั้งหมดจาก Supabase ตาราง admin_queue
  selectedAdmin: null,
  shops: [],        // รายชื่อร้านค้าทั้งหมดจาก Supabase
  searchQuery: "",  // คำค้นหาร้านค้าบนบอร์ด
  boardFilter: "all", // ฟิลเตอร์กระดาน (all, free, occupied, mine)
  liveInterval: null // ตัวแปรสำหรับ setInterval
};

// อ้างอิงอิลิเมนต์ใน HTML (DOM Elements)
const dom = {
  loadingOverlay: document.getElementById('loading-overlay'),
  adminSelect: document.getElementById('admin-select'),
  currentUserInfo: document.getElementById('current-user-info'),
  myStatusBadge: document.getElementById('my-status-badge'),
  noAdminsWarning: document.getElementById('no-admins-warning'),
  actionPanel: document.getElementById('action-panel'),
  actionUserName: document.getElementById('action-user-name'),
  btnCheckin: document.getElementById('btn-checkin'),
  btnCheckout: document.getElementById('btn-checkout'),
  shopBoardSearchInput: document.getElementById('shop-board-search-input'),
  shopBoardGrid: document.getElementById('shop-board-grid'),
  shopBoardFilters: document.getElementById('shop-board-filters'),
  tabMyShops: document.getElementById('tab-my-shops'),
  adminTableBody: document.getElementById('admin-table-body'),
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

  // ตั้งช่วงเวลานับ Live Timers ทุกวินาที
  setInterval(() => {
    updateLiveTimers();
    updateAdminTableTimers();
  }, 1000);
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
      'คุณต้องการลงชื่อออกงาน (Check-Out) จากระบบปฏิบัติงานใช่หรือไม่?',
      'ยืนยันการ Check-Out',
      'modal-icon-danger',
      'fa-right-from-bracket'
    );
    if (isConfirm) executeAction('checkOut');
  });

  if (dom.shopBoardSearchInput) {
    dom.shopBoardSearchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.trim().toLowerCase();
      renderShopBoard();
    });
  }

  if (dom.shopBoardFilters) {
    dom.shopBoardFilters.addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      dom.shopBoardFilters.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      tab.classList.add('active');
      appState.boardFilter = tab.dataset.filter;
      renderShopBoard();
    });
  }

  dom.btnManualReset.addEventListener('click', async () => {
    const password = await showCustomPrompt(
      'กรุณาพิมพ์คำว่า "RESET" (ตัวพิมพ์ใหญ่ทั้งหมด)\nเพื่อยืนยันการล้างข้อมูลการทำงานและยอดเคสสะสมของวันนี้:',
      'ยืนยันการรีเซ็ตระบบประจำวัน',
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

    const mapped = (data || []).map(row => {
      // ดึงร้านค้าที่กำลังทำงานอยู่ (จาก JSON หรือ Legacy Text)
      let activeShops = [];
      if (row.current_shop_code) {
        if (row.current_shop_code.startsWith('[')) {
          try {
            activeShops = JSON.parse(row.current_shop_code);
          } catch (e) {
            console.error('Error parsing JSON from current_shop_code:', e);
          }
        } else {
          // รองรับข้อมูล Legacy แบบเดิม
          activeShops = [{
            shop_code: row.current_shop_code,
            shop_name: row.current_shop_name || 'ร้านค้า',
            assigned_at: row.last_action_time || new Date().toISOString()
          }];
        }
      }

      return {
        name: row.name,
        status: row.status || 'Offline',
        checkInTime: row.check_in_time,
        completedCases: row.completed_cases || 0,
        lastActionTime: row.last_action_time,
        activeShops: activeShops
      };
    });

    appState.admins = mapped;

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
        result = await dbCompleteCase(appState.selectedAdmin, extraData);
        break;
      case 'cancelCase':
        result = await dbCancelCase(appState.selectedAdmin, extraData);
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

  if (adminData && adminData.status === 'Online') {
    return { success: true, message: adminName + ' ลงชื่อเข้างานอยู่แล้ว' };
  }

  const now = new Date().toISOString();

  if (adminData) {
    const { error } = await db.from('admin_queue').update({
      status: 'Online', check_in_time: now, last_action_time: now, current_shop_code: null, current_shop_name: null
    }).eq('name', adminName);
    if (error) return { success: false, message: error.message };
  } else {
    const { error } = await db.from('admin_queue').insert({
      name: adminName, status: 'Online', check_in_time: now, completed_cases: 0, last_action_time: now, current_shop_code: null, current_shop_name: null
    });
    if (error) return { success: false, message: error.message };
  }

  return { success: true, message: adminName + ' ลงชื่อเข้างานสำเร็จ (Online)' };
}

async function dbCheckOut(adminName) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };

  const { data: adminData } = await db.from('admin_queue').select('current_shop_code').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  // ตรวจสอบว่ายังมีงานค้างอยู่หรือไม่
  let activeShops = [];
  if (adminData.current_shop_code && adminData.current_shop_code.startsWith('[')) {
    try {
      activeShops = JSON.parse(adminData.current_shop_code);
    } catch (e) {}
  } else if (adminData.current_shop_code) {
    activeShops = [adminData.current_shop_code];
  }

  if (activeShops.length > 0) {
    return { success: false, message: 'คุณยังมีตรวจงานร้านค้างอยู่ กรุณากด "จบงาน" ให้เรียบร้อยก่อนลงชื่อออกงาน' };
  }

  const now = new Date().toISOString();

  const { error } = await db.from('admin_queue').update({
    status: 'Offline', current_shop_code: null, current_shop_name: null, last_action_time: now
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  return { success: true, message: adminName + ' ลงชื่อออกงานเรียบร้อยแล้ว' };
}

/**
 * กดรับเคสร้านค้าแบบเรียลไทม์พร้อมเช็คการทำงานซ้ำซ้อน
 */
async function dbAcceptCase(adminName, shopData) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };
  if (!shopData) return { success: false, message: 'กรุณาเลือกร้านค้า' };

  // ตรวจสอบสถานะการเข้างานของแอดมินคนนี้ก่อน
  const { data: adminData } = await db.from('admin_queue').select('status, current_shop_code').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };
  if (adminData.status !== 'Online') {
    return { success: false, message: 'กรุณาลงชื่อเข้างาน (Check-In) ก่อนเริ่มรับเคส' };
  }

  // --- ป้องกันการรับงานซ้ำระดับฐานข้อมูล ---
  const { data: allActiveData, error: activeErr } = await db.from('admin_queue').select('name, current_shop_code').eq('status', 'Online');
  if (activeErr) return { success: false, message: activeErr.message };

  let existingOwner = null;
  if (allActiveData) {
    for (const r of allActiveData) {
      if (r.current_shop_code) {
        let activeShops = [];
        if (r.current_shop_code.startsWith('[')) {
          try { activeShops = JSON.parse(r.current_shop_code); } catch(e) {}
        } else {
          activeShops = [{ shop_code: r.current_shop_code }];
        }
        
        if (activeShops.some(s => s.shop_code === shopData.shop_code)) {
          existingOwner = r.name;
          break;
        }
      }
    }
  }

  if (existingOwner) {
    return { success: false, message: 'ขออภัย! ร้านค้านี้มีผู้ดูแลแล้วคือ คุณ' + existingOwner };
  }

  // จัดการเพิ่มร้านเข้าฟิลด์ JSON ของตัวเอง
  let myActiveShops = [];
  if (adminData.current_shop_code && adminData.current_shop_code.startsWith('[')) {
    try {
      myActiveShops = JSON.parse(adminData.current_shop_code);
    } catch (e) {}
  } else if (adminData.current_shop_code) {
    myActiveShops = [{
      shop_code: adminData.current_shop_code,
      shop_name: 'ร้านค้า',
      assigned_at: new Date().toISOString()
    }];
  }

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  // บันทึกเวลาเริ่มทำเคสใน case_logs
  const { error: logError } = await db.from('case_logs').insert({
    admin_name: adminName,
    start_time: now,
    date: todayDate,
    shop_code: shopData.shop_code,
    shop_name: shopData.shop_name
  });
  if (logError) console.error('Error logging case:', logError);

  // อัปเดตรายการร้านของแอดมินคนนี้
  myActiveShops.push({
    shop_code: shopData.shop_code,
    shop_name: shopData.shop_name,
    assigned_at: now
  });

  const { error } = await db.from('admin_queue').update({
    current_shop_code: JSON.stringify(myActiveShops),
    last_action_time: now
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  return { success: true, message: adminName + ' เริ่มรับเคส — ร้าน: ' + shopData.shop_name };
}

async function dbCompleteCase(adminName, shopCode) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };
  if (!shopCode) return { success: false, message: 'กรุณาระบุรหัสร้านค้า' };

  const { data: adminData } = await db.from('admin_queue').select('completed_cases, current_shop_code').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  let activeShops = [];
  if (adminData.current_shop_code && adminData.current_shop_code.startsWith('[')) {
    try {
      activeShops = JSON.parse(adminData.current_shop_code);
    } catch (e) {}
  } else if (adminData.current_shop_code) {
    activeShops = [{
      shop_code: adminData.current_shop_code,
      shop_name: 'ร้านค้า',
      assigned_at: new Date().toISOString()
    }];
  }

  const targetShop = activeShops.find(s => s.shop_code === shopCode);
  if (!targetShop) {
    return { success: false, message: 'ไม่พบข้อมูลร้านค้านี้ในระบบปฏิบัติงานของคุณ' };
  }

  const now = new Date().toISOString();

  // อัปเดตตาราง case_logs ค้นหาเคสร้านนี้ที่ยังไม่จบงาน (end_time is null)
  const { data: logData } = await db.from('case_logs')
    .select('log_id, start_time')
    .eq('admin_name', adminName)
    .eq('shop_code', shopCode)
    .is('end_time', null)
    .order('start_time', { ascending: false })
    .limit(1);

  let durationSeconds = 0;
  if (logData && logData.length > 0) {
    const startTime = new Date(logData[0].start_time);
    durationSeconds = Math.round((new Date(now).getTime() - startTime.getTime()) / 1000);
    await db.from('case_logs').update({ end_time: now, duration_seconds: durationSeconds }).eq('log_id', logData[0].log_id);
  }

  // เอาชื่อร้านนี้ออกจากรายการงานของแอดมิน
  const updatedActiveShops = activeShops.filter(s => s.shop_code !== shopCode);
  const nextShopCodeString = updatedActiveShops.length > 0 ? JSON.stringify(updatedActiveShops) : null;

  const { error } = await db.from('admin_queue').update({
    current_shop_code: nextShopCodeString,
    completed_cases: (adminData.completed_cases || 0) + 1,
    last_action_time: now
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  return {
    success: true,
    message: adminName + ' จบเคสร้าน ' + targetShop.shop_name + ' เรียบร้อยแล้ว ใช้เวลา ' + formatDurationText(durationSeconds)
  };
}

async function dbCancelCase(adminName, shopCode) {
  if (!adminName) return { success: false, message: 'กรุณาระบุชื่อ Admin' };
  if (!shopCode) return { success: false, message: 'กรุณาระบุรหัสร้านค้า' };

  const { data: adminData } = await db.from('admin_queue').select('current_shop_code').eq('name', adminName).single();
  if (!adminData) return { success: false, message: 'ไม่พบรายชื่อ Admin ในระบบ' };

  let activeShops = [];
  if (adminData.current_shop_code && adminData.current_shop_code.startsWith('[')) {
    try {
      activeShops = JSON.parse(adminData.current_shop_code);
    } catch (e) {}
  } else if (adminData.current_shop_code) {
    activeShops = [{
      shop_code: adminData.current_shop_code,
      shop_name: 'ร้านค้า',
      assigned_at: new Date().toISOString()
    }];
  }

  const targetShop = activeShops.find(s => s.shop_code === shopCode);
  if (!targetShop) {
    return { success: false, message: 'ไม่พบข้อมูลร้านค้านี้ในระบบปฏิบัติงานของคุณ' };
  }

  // ลบประวัติเคสนี้ที่ยังไม่จบงานใน case_logs
  await db.from('case_logs').delete()
    .eq('admin_name', adminName)
    .eq('shop_code', shopCode)
    .is('end_time', null);

  // นำร้านนี้ออกจากรายการงานของแอดมิน
  const updatedActiveShops = activeShops.filter(s => s.shop_code !== shopCode);
  const nextShopCodeString = updatedActiveShops.length > 0 ? JSON.stringify(updatedActiveShops) : null;

  const { error } = await db.from('admin_queue').update({
    current_shop_code: nextShopCodeString,
    last_action_time: new Date().toISOString()
  }).eq('name', adminName);
  if (error) return { success: false, message: error.message };

  return { success: true, message: adminName + ' ยกเลิกเคสร้าน ' + targetShop.shop_name + ' เรียบร้อยแล้ว (ยอดเคสสะสมไม่ถูกนับ)' };
}

async function dbResetAll() {
  const { data: allAdmins, error: fetchErr } = await db.from('admin_queue').select('name');
  if (fetchErr) return { success: false, message: fetchErr.message };

  const now = new Date().toISOString();
  if (allAdmins) {
    for (const admin of allAdmins) {
      await db.from('admin_queue').update({
        status: 'Offline', queue_num: null, check_in_time: null, completed_cases: 0,
        last_action_time: now, current_shop_code: null, current_shop_name: null
      }).eq('name', admin.name);
    }
  }
  return { success: true, message: 'รีเซ็ตข้อมูลการทำงานและเคสสะสมประจำวันเรียบร้อยแล้ว' };
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

  const allWorkingAdmins = appState.admins.filter(a => a.status === 'Online');
  dom.noAdminsWarning.style.display = allWorkingAdmins.length === 0 ? 'flex' : 'none';

  updateActionPanel();
  renderShopBoard();
  renderAdminTable();
  renderSummaryDashboard();
}

function populateAdminSelect() {
  const allAdmins = [];
  appState.admins.forEach(a => {
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

function getShopClaimInfo(shopCode) {
  for (const admin of appState.admins) {
    if (admin.status === 'Online' && admin.activeShops) {
      const activeShop = admin.activeShops.find(s => s.shop_code === shopCode);
      if (activeShop) {
        return {
          adminName: admin.name,
          assignedAt: activeShop.assigned_at
        };
      }
    }
  }
  return null;
}

function renderShopBoard() {
  if (!dom.shopBoardGrid) return;
  dom.shopBoardGrid.innerHTML = '';

  const query = appState.searchQuery || '';
  let filtered = query
    ? appState.shops.filter(s =>
        s.shop_name.toLowerCase().includes(query) ||
        s.shop_code.toLowerCase().includes(query)
      )
    : appState.shops;

  const currentAdminData = appState.selectedAdmin ? findAdminData(appState.selectedAdmin) : null;
  const isCurrentOnline = currentAdminData && currentAdminData.status === 'Online';

  // ซ่อน/แสดงแท็บ "งานของฉัน"
  if (dom.tabMyShops) {
    if (isCurrentOnline) {
      dom.tabMyShops.style.display = 'inline-flex';
    } else {
      dom.tabMyShops.style.display = 'none';
      if (appState.boardFilter === 'mine') {
        appState.boardFilter = 'all';
        if (dom.shopBoardFilters) {
          dom.shopBoardFilters.querySelectorAll('.filter-tab').forEach(b => {
            if (b.dataset.filter === 'all') b.classList.add('active');
            else b.classList.remove('active');
          });
        }
      }
    }
  }

  // กรองตามหมวดหมู่แท็บที่เลือก
  filtered = filtered.filter(shop => {
    const claimInfo = getShopClaimInfo(shop.shop_code);
    if (appState.boardFilter === 'free') {
      return !claimInfo;
    } else if (appState.boardFilter === 'occupied') {
      return !!claimInfo;
    } else if (appState.boardFilter === 'mine') {
      return claimInfo && claimInfo.adminName === appState.selectedAdmin;
    }
    return true; // all
  });

  if (filtered.length === 0) {
    dom.shopBoardGrid.innerHTML = '<div class="no-data"><i class="fa-solid fa-magnifying-glass"></i> ไม่พบร้านค้าที่ตรงกับตัวกรองหรือคำค้นหา</div>';
    return;
  }

  filtered.forEach(shop => {
    const card = document.createElement('div');
    card.className = 'shop-card card';
    card.dataset.shopCode = shop.shop_code;

    const claimInfo = getShopClaimInfo(shop.shop_code);

    let html = `
      <div class="shop-card-header">
        <span class="shop-code">${shop.shop_code}</span>
        <span class="shop-name-title">${shop.shop_name}</span>
      </div>
    `;

    if (!claimInfo) {
      // ร้านค้ายังไม่มีคนรับงาน
      html += `
        <div class="shop-card-body free">
          <span class="badge-free"><i class="fa-solid fa-circle-check"></i> ว่าง</span>
        </div>
        <div class="shop-card-footer">
      `;
      if (isCurrentOnline) {
        html += `
          <button class="btn-claim-shop" onclick="handleClaimShop('${shop.shop_code}', '${shop.shop_name.replace(/'/g, "\\'")}')">
            <i class="fa-solid fa-hand-holding-hand"></i> กดรับเคส
          </button>
        `;
      } else {
        html += `
          <button class="btn-claim-shop disabled" disabled title="กรุณาลงชื่อเข้างานก่อน">
            <i class="fa-solid fa-lock"></i> ต้องลงชื่อเข้างานก่อน
          </button>
        `;
      }
      html += `</div>`;
    } else {
      // ร้านค้ามีคนรับงานแล้ว
      const isOwner = appState.selectedAdmin === claimInfo.adminName;
      card.classList.add(isOwner ? 'owned-shop' : 'occupied-shop');

      const timeDiff = Math.round((Date.now() - new Date(claimInfo.assignedAt).getTime()) / 1000);
      const timerStr = formatSecondsToTimer(timeDiff >= 0 ? timeDiff : 0);

      html += `
        <div class="shop-card-body occupied">
          <span class="badge-occupied">
            <i class="fa-solid fa-user-clock"></i> ${claimInfo.adminName}
          </span>
          <div class="live-timer-wrapper">
            <i class="fa-regular fa-clock"></i>
            <span class="live-shop-timer" data-assigned-at="${claimInfo.assignedAt}">${timerStr}</span>
          </div>
        </div>
        <div class="shop-card-footer">
      `;

      if (isOwner) {
        html += `
          <div class="owner-actions">
            <button class="btn-complete-shop" onclick="handleCompleteShop('${shop.shop_code}', '${shop.shop_name.replace(/'/g, "\\'")}')">
              <i class="fa-solid fa-check-double"></i> จบงาน
            </button>
            <button class="btn-cancel-shop" onclick="handleCancelShop('${shop.shop_code}', '${shop.shop_name.replace(/'/g, "\\'")}')" title="ยกเลิกรับเคส">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      } else {
        html += `
          <div class="shop-card-blocked-msg">
            <i class="fa-solid fa-ban"></i> มีผู้ดูแลแล้ว
          </div>
        `;
      }
      html += `</div>`;
    }

    card.innerHTML = html;
    dom.shopBoardGrid.appendChild(card);
  });
}

window.handleClaimShop = async (shopCode, shopName) => {
  executeAction('acceptCase', { shop_code: shopCode, shop_name: shopName });
};

window.handleCompleteShop = async (shopCode, shopName) => {
  const isConfirm = await showCustomConfirm(
    `คุณต้องการจบงานร้านค้า "${shopName}" ใช่หรือไม่?`,
    'ยืนยันการจบงาน',
    'modal-icon-success',
    'fa-circle-check'
  );
  if (isConfirm) {
    executeAction('completeCase', shopCode);
  }
};

window.handleCancelShop = async (shopCode, shopName) => {
  const isConfirm = await showCustomConfirm(
    `คุณต้องการยกเลิกรับงานร้านค้า "${shopName}" ใช่หรือไม่?\n(เวลาและสถิติประวัติงานชิ้นนี้จะไม่ถูกบันทึก)`,
    'ยืนยันการยกเลิกเคส',
    'modal-icon-danger',
    'fa-circle-exclamation'
  );
  if (isConfirm) {
    executeAction('cancelCase', shopCode);
  }
};

function updateActionPanel() {
  if (!appState.selectedAdmin) {
    dom.actionPanel.style.display = 'none';
    return;
  }

  dom.actionPanel.style.display = 'block';
  dom.actionUserName.textContent = appState.selectedAdmin;

  const adminData = findAdminData(appState.selectedAdmin);
  const status = (adminData && adminData.status) ? adminData.status : "Offline";

  dom.btnCheckin.style.display = 'none';
  dom.btnCheckout.style.display = 'none';

  if (status === "Offline") {
    dom.btnCheckin.style.display = 'inline-flex';
  } else {
    dom.btnCheckout.style.display = 'inline-flex';
  }
}

function renderAdminTable() {
  if (!dom.adminTableBody) return;
  dom.adminTableBody.innerHTML = '';

  // เรียงลำดับแอดมิน: ออนไลน์ก่อน จากนั้นเรียงชื่อตามตัวอักษรไทย
  const sortedAdmins = [...appState.admins].sort((a, b) => {
    if (a.status === 'Online' && b.status !== 'Online') return -1;
    if (a.status !== 'Online' && b.status === 'Online') return 1;
    return a.name.localeCompare(b.name, 'th');
  });

  if (sortedAdmins.length === 0) {
    dom.adminTableBody.innerHTML = '<tr><td colspan="4" class="no-data">ยังไม่มีข้อมูลแอดมินในระบบ</td></tr>';
    return;
  }

  sortedAdmins.forEach(admin => {
    const tr = document.createElement('tr');
    if (admin.name === appState.selectedAdmin) {
      tr.className = 'my-row';
    }

    // 1. รายชื่อแอดมิน
    const isCurrent = admin.name === appState.selectedAdmin;
    const nameText = isCurrent ? `<strong>${admin.name} (คุณ)</strong>` : admin.name;
    const nameTd = `<td>${nameText}</td>`;

    // 2. สถานะ
    const statusText = translateStatus(admin.status);
    const statusBadgeClass = getStatusBadgeClass(admin.status);
    const statusTd = `<td><span class="status-badge ${statusBadgeClass}">${statusText}</span></td>`;

    // 3. ร้านค้าที่ดูแลอยู่
    let shopsHtml = '';
    if (admin.status === 'Online' && admin.activeShops && admin.activeShops.length > 0) {
      shopsHtml = '<div class="admin-shops-container">';
      admin.activeShops.forEach(shop => {
        const timeDiff = Math.round((Date.now() - new Date(shop.assigned_at).getTime()) / 1000);
        const timerStr = formatSecondsToTimer(timeDiff >= 0 ? timeDiff : 0);
        shopsHtml += `
          <div class="admin-shop-item-badge">
            <span class="admin-shop-name" title="${shop.shop_name}">${shop.shop_code}</span>
            <span class="admin-table-live-timer" data-assigned-at="${shop.assigned_at}">${timerStr}</span>
          </div>
        `;
      });
      shopsHtml += '</div>';
    } else if (admin.status === 'Online') {
      shopsHtml = '<span class="no-shops-text"><i class="fa-solid fa-mug-hot"></i> ว่าง (รอรับเคส)</span>';
    } else {
      shopsHtml = '<span class="offline-text">-</span>';
    }
    const shopsTd = `<td>${shopsHtml}</td>`;

    // 4. เคสวันนี้
    const casesTd = `<td style="text-align: center;"><span class="cases-count">${admin.completedCases || 0}</span></td>`;

    tr.innerHTML = nameTd + statusTd + shopsTd + casesTd;
    dom.adminTableBody.appendChild(tr);
  });
}

function renderSummaryDashboard() {
  dom.adminsStatsList.innerHTML = '';

  let totalCases = 0;
  let activeAdminsCount = 0;

  appState.admins.forEach(admin => {
    totalCases += admin.completedCases || 0;
    if ((admin.status || "Offline") !== "Offline") activeAdminsCount++;
  });

  dom.totalCasesToday.textContent = totalCases;
  dom.totalAdminsActive.textContent = activeAdminsCount;

  // เรียงแอดมินที่มีเคสมากที่สุดลงไป
  const sortedStats = [...appState.admins].sort((a, b) => (b.completedCases || 0) - (a.completedCases || 0));
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

function findAdminData(adminName) {
  return appState.admins.find(a => a.name === adminName);
}

function translateStatus(status) {
  switch (status) {
    case "Online": return "Online";
    case "Offline": return "Offline";
    default: return status || "Offline";
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case "Online": return "status-active";
    case "Offline": return "status-offline";
    default: return "status-offline";
  }
}

function updateLiveTimers() {
  const timerElements = document.querySelectorAll('.live-shop-timer');
  timerElements.forEach(el => {
    const assignedAt = el.getAttribute('data-assigned-at');
    if (assignedAt) {
      const timeDiff = Math.round((Date.now() - new Date(assignedAt).getTime()) / 1000);
      el.textContent = formatSecondsToTimer(timeDiff >= 0 ? timeDiff : 0);
    }
  });
}

function updateAdminTableTimers() {
  const timerElements = document.querySelectorAll('.admin-table-live-timer');
  timerElements.forEach(el => {
    const assignedAt = el.getAttribute('data-assigned-at');
    if (assignedAt) {
      const timeDiff = Math.round((Date.now() - new Date(assignedAt).getTime()) / 1000);
      el.textContent = formatSecondsToTimer(timeDiff >= 0 ? timeDiff : 0);
    }
  });
}

function formatSecondsToTimer(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
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
