const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbydoloL4fATV-uUpepes2Qil4ijt865o3o5wMZam1AXpTG2fL1botlmGDBwoX66yYI5/exec',
  USERS: [
    { id: 'james', name: 'James', avatar: '👨‍💼', color: '#818cf8' },
    { id: 'jiawen', name: '佳文', avatar: '👩‍🏫', color: '#f472b6' }
  ]
};

function currentMonth() {
  const d = new Date();
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
