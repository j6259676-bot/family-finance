const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbymZyKqTwUFO--wTrsauYIsLnSwHqq0Thqjjoi6a3RfWUiMVYzkq_Qk6Zaq8-VDmutK/exec',
  USERS: [
    { id: 'james', name: 'James', avatar: '👨‍💼', color: '#818cf8' },
    { id: 'jiawen', name: '佳文', avatar: '👩‍🏫', color: '#f472b6' }
  ]
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMoney(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('zh-TW');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
