const charts = {};
const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

const palette = {
  teal: '#0f766e',
  blue: '#2563eb',
  amber: '#d97706',
  rose: '#be123c',
  violet: '#7c3aed',
  green: '#16a34a'
};

const form = document.getElementById('companyForm');
const input = document.getElementById('companyInput');
const statusMessage = document.getElementById('statusMessage');
const suggestions = document.getElementById('suggestions');
const quickPicks = document.querySelector('.quick-picks');

let searchTimer = null;
let searchController = null;

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index'
  },
  animation: {
    duration: 850,
    easing: 'easeOutQuart'
  },
  plugins: {
    legend: {
      labels: {
        boxWidth: 12,
        boxHeight: 12,
        color: '#435158',
        font: {
          family: 'Inter',
          size: 12,
          weight: '600'
        }
      }
    },
    tooltip: {
      backgroundColor: '#142126',
      padding: 12,
      titleFont: { family: 'Inter', weight: '700' },
      bodyFont: { family: 'Inter' }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#68767c', font: { family: 'Inter', weight: '600' } }
    },
    y: {
      beginAtZero: true,
      grid: { color: '#e7eef0' },
      ticks: { color: '#68767c', font: { family: 'Inter', weight: '600' } }
    }
  }
};

form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadCompany(input.value.trim());
});

input.addEventListener('input', () => {
  const query = input.value.trim();
  window.clearTimeout(searchTimer);

  if (query.length < 2) {
    suggestions.innerHTML = '';
    return;
  }

  searchTimer = window.setTimeout(() => loadSuggestions(query), 240);
});

suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-symbol]');
  if (!button) return;
  input.value = button.dataset.symbol;
  suggestions.innerHTML = '';
  loadCompany(button.dataset.symbol);
});

quickPicks.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-query]');
  if (!button) return;
  input.value = button.dataset.query;
  loadCompany(button.dataset.query);
});

document.querySelectorAll('.interactive-card').forEach((card) => {
  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--rx', `${(-y * 3).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${(x * 3).toFixed(2)}deg`);
  });

  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
});

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function setLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

async function loadSuggestions(query) {
  if (searchController) {
    searchController.abort();
  }

  searchController = new AbortController();

  try {
    const response = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: searchController.signal
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to search companies.');
    }

    renderSuggestions(payload.matches || []);
  } catch (error) {
    if (error.name === 'AbortError') return;
    suggestions.innerHTML = '';
  }
}

async function loadCompany(query) {
  if (!query) return;

  setLoading(true);
  setStatus(`Searching live market data for "${query}"...`);

  try {
    const response = await apiFetch(`/api/company?q=${encodeURIComponent(query)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load company data.');
    }

    renderDashboard(payload);
    renderSuggestions(payload.matches || []);
    setStatus(payload.warning || `Loaded ${payload.company.name} from ${payload.company.exchange}. Live data source: Yahoo Finance public endpoints.`);
  } catch (error) {
    setStatus(makeFriendlyError(error), true);
  } finally {
    setLoading(false);
  }
}

function apiFetch(path, options = {}) {
  return fetch(`${apiBase}${path}`, options);
}

function makeFriendlyError(error) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return 'Could not reach the local server. Run npm start, then open http://localhost:3000. If you opened index.html directly, keep the server running in the background.';
  }

  return error.message || 'Something went wrong while loading company data.';
}

function renderSuggestions(matches) {
  suggestions.innerHTML = '';

  matches.slice(0, 6).forEach((match) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.dataset.symbol = match.symbol;
    button.innerHTML = `<strong>${escapeHtml(match.symbol)} - ${escapeHtml(match.name)}</strong><span>${escapeHtml(match.exchange)}${match.industry ? ` | ${escapeHtml(match.industry)}` : ''}</span>`;
    suggestions.appendChild(button);
  });
}

function renderDashboard(data) {
  const { company, metrics, charts: chartData } = data;
  const currency = company.currency || 'USD';

  document.getElementById('dashboardTitle').textContent = company.name;
  document.getElementById('dashboardSubtitle').textContent = `${company.symbol} | ${company.exchange} | ${company.industry || 'Public company'}`;
  document.getElementById('symbolBadge').textContent = company.symbol;
  document.getElementById('priceChartNote').textContent = `Monthly adjusted close in ${currency}`;

  document.getElementById('priceMetric').textContent = formatCurrency(metrics.price, currency);
  document.getElementById('rangeMetric').textContent = `${formatCurrency(metrics.fiftyTwoWeekLow, currency)} - ${formatCurrency(metrics.fiftyTwoWeekHigh, currency)}`;
  document.getElementById('exchangeMetric').textContent = company.exchange;
  document.getElementById('revenueMetric').textContent = formatCompact(metrics.totalRevenue, currency);
  document.getElementById('revenueDateMetric').textContent = metrics.totalRevenueDate || 'Latest reported period';
  document.getElementById('incomeMetric').textContent = formatCompact(metrics.netIncome, currency);
  document.getElementById('incomeDateMetric').textContent = metrics.netIncomeDate || 'Latest reported period';

  const changeMetric = document.getElementById('changeMetric');
  changeMetric.textContent = `${formatSigned(metrics.change, currency)} (${formatPercent(metrics.changePercent)}) today`;
  changeMetric.className = metrics.change >= 0 ? 'positive' : 'negative';

  drawChart('priceChart', {
    type: 'line',
    data: {
      labels: chartData.price.labels,
      datasets: [{
        label: `Price (${currency})`,
        data: chartData.price.values,
        borderColor: palette.teal,
        backgroundColor: 'rgba(15, 118, 110, 0.14)',
        pointRadius: 3,
        pointHoverRadius: 7,
        tension: 0.35,
        fill: true
      }]
    },
    options: baseOptions
  });

  drawChart('quarterlyRevenueChart', {
    type: 'bar',
    data: {
      labels: chartData.quarterlyRevenue.labels,
      datasets: [{
        label: `Revenue (${currency})`,
        data: chartData.quarterlyRevenue.values,
        backgroundColor: palette.blue,
        hoverBackgroundColor: '#1d4ed8',
        borderRadius: 6
      }]
    },
    options: compactMoneyOptions(currency)
  });

  drawChart('netIncomeChart', {
    type: 'bar',
    data: {
      labels: chartData.netIncome.labels,
      datasets: [{
        label: `Net Income (${currency})`,
        data: chartData.netIncome.values,
        backgroundColor: palette.green,
        hoverBackgroundColor: '#15803d',
        borderRadius: 6
      }]
    },
    options: compactMoneyOptions(currency)
  });

  drawChart('volumeChart', {
    type: 'line',
    data: {
      labels: chartData.volume.labels,
      datasets: [{
        label: 'Trading Volume',
        data: chartData.volume.values,
        borderColor: palette.amber,
        backgroundColor: 'rgba(217, 119, 6, 0.16)',
        pointRadius: 3,
        pointHoverRadius: 7,
        tension: 0.32,
        fill: true
      }]
    },
    options: compactNumberOptions()
  });

  drawChart('mixChart', {
    type: 'bar',
    data: {
      labels: ['Total Revenue', 'Gross Profit', 'Net Income'],
      datasets: [{
        label: `TTM Financials (${currency})`,
        data: [metrics.totalRevenue, metrics.grossProfit, metrics.netIncome].map((value) => Math.max(value || 0, 0)),
        backgroundColor: [palette.blue, palette.teal, palette.green],
        hoverBackgroundColor: ['#1d4ed8', '#115e59', '#15803d'],
        borderRadius: 6
      }]
    },
    options: compactMoneyOptions(currency)
  });
}

function drawChart(id, config) {
  if (charts[id]) {
    charts[id].destroy();
  }
  charts[id] = new Chart(document.getElementById(id), config);
}

function compactMoneyOptions(currency) {
  return {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales.y,
        ticks: {
          ...baseOptions.scales.y.ticks,
          callback: (value) => formatCompact(value, currency)
        }
      }
    }
  };
}

function compactNumberOptions() {
  return {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales.y,
        ticks: {
          ...baseOptions.scales.y.ticks,
          callback: (value) => formatNumber(value)
        }
      }
    }
  };
}

function formatCurrency(value, currency) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function formatSigned(value, currency) {
  if (!Number.isFinite(value)) return '--';
  const formatted = formatCurrency(Math.abs(value), currency);
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}

function formatCompact(value, currency) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

loadCompany('Apple');
