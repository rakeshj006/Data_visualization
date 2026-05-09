const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ONE_YEAR_SECONDS = 366 * 24 * 60 * 60;
const INDIAN_QUERY_HINTS = [
  'tata',
  'reliance',
  'infosys',
  'wipro',
  'hdfc',
  'icici',
  'sbi',
  'mahindra',
  'adani',
  'maruti',
  'bajaj',
  'axis',
  'kotak',
  'itc',
  'ongc',
  'zomato'
];

const aliasSymbols = new Map([
  ['reliance', 'RELIANCE.NS'],
  ['reliance industries', 'RELIANCE.NS'],
  ['tata motors', 'TMCV.NS'],
  ['tata steel', 'TATASTEEL.NS'],
  ['tata power', 'TATAPOWER.NS'],
  ['tcs', 'TCS.NS'],
  ['tata consultancy', 'TCS.NS'],
  ['infosys', 'INFY.NS'],
  ['wipro', 'WIPRO.NS'],
  ['hdfc bank', 'HDFCBANK.NS'],
  ['icici bank', 'ICICIBANK.NS'],
  ['sbi', 'SBIN.NS']
]);

const boostedCompanies = [
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services Limited', exchange: 'NSE', industry: 'Information Technology Services' },
  { symbol: 'TMCV.NS', name: 'Tata Motors Limited', exchange: 'NSE', industry: 'Auto Manufacturers' },
  { symbol: 'TATASTEEL.NS', name: 'Tata Steel Limited', exchange: 'NSE', industry: 'Steel' },
  { symbol: 'TATAPOWER.NS', name: 'Tata Power Company Limited', exchange: 'NSE', industry: 'Utilities' },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', exchange: 'NSE', industry: 'Oil & Gas Refining & Marketing' },
  { symbol: 'INFY.NS', name: 'Infosys Limited', exchange: 'NSE', industry: 'Information Technology Services' },
  { symbol: 'WIPRO.NS', name: 'Wipro Limited', exchange: 'NSE', industry: 'Information Technology Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', exchange: 'NSE', industry: 'Banks' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Limited', exchange: 'NSE', industry: 'Banks' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE', industry: 'Banks' },
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises Limited', exchange: 'NSE', industry: 'Conglomerates' },
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki India Limited', exchange: 'NSE', industry: 'Auto Manufacturers' }
];

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      sendCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/api/search') {
      await handleSearch(url, res);
      return;
    }

    if (url.pathname === '/api/company') {
      await handleCompany(url, res);
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Company dashboard running at http://localhost:${PORT}`);
});

async function handleSearch(url, res) {
  const query = url.searchParams.get('q');
  if (!query || query.trim().length < 2) {
    sendJson(res, 200, { matches: [] });
    return;
  }

  const matches = await searchCompanies(query);
  sendJson(res, 200, { matches });
}

async function handleCompany(url, res) {
  const query = url.searchParams.get('q');
  if (!query) {
    sendJson(res, 400, { error: 'Enter a company name or stock symbol.' });
    return;
  }

  const matches = await searchCompanies(query);

  if (!matches.length) {
    sendJson(res, 404, { error: `No public equity match found for "${query}". Try a stock symbol like AAPL, MSFT, TSLA, or INFY.` });
    return;
  }

  const candidates = orderMatches(matches, query).slice(0, 6);
  let dashboard = null;
  const errors = [];

  for (const candidate of candidates) {
    try {
      dashboard = await buildCompanyDashboard(candidate, matches);
      break;
    } catch (error) {
      errors.push(`${candidate.symbol}: ${error.message}`);
    }
  }

  if (!dashboard) {
    sendJson(res, 502, {
      error: 'I found matching companies, but the market provider did not return usable chart data right now. Try a more specific symbol like TCS.NS, TATAPOWER.NS, TATASTEEL.NS, or RELIANCE.NS.',
      details: errors
    });
    return;
  }

  sendJson(res, 200, dashboard);
}

async function buildCompanyDashboard(primary, matches) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - ONE_YEAR_SECONDS;
  const period2 = now;

  const [chartResult, quoteChartResult, fundamentalsResult] = await Promise.allSettled([
    fetchChart(primary.symbol),
    fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(primary.symbol)}?range=1d&interval=1m`),
    fetchJson(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(primary.symbol)}?symbol=${encodeURIComponent(primary.symbol)}&type=trailingTotalRevenue,trailingGrossProfit,trailingNetIncome,quarterlyTotalRevenue,quarterlyNetIncome&merge=false&period1=${period1}&period2=${period2}`)
  ]);

  if (chartResult.status === 'rejected') {
    throw chartResult.reason;
  }

  const chart = chartResult.value;
  const quoteChart = quoteChartResult.status === 'fulfilled' ? quoteChartResult.value : {};
  const fundamentals = fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : {};
  const result = chart.chart && chart.chart.result && chart.chart.result[0];
  if (!result) {
    throw new Error('No chart data returned.');
  }

  const quoteResult = quoteChart.chart && quoteChart.chart.result && quoteChart.chart.result[0];
  const meta = {
    ...(result.meta || {}),
    ...((quoteResult && quoteResult.meta) || {})
  };
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0] ? result.indicators.quote[0] : {};
  const adjClose = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] ? result.indicators.adjclose[0].adjclose : quote.close;
  const timestamps = result.timestamp || [];
  const prices = zipSeries(timestamps, adjClose || []);
  const volumes = zipSeries(timestamps, quote.volume || []);

  const series = parseFundamentals(fundamentals);
  const revenue = latest(series.trailingTotalRevenue);
  const grossProfit = latest(series.trailingGrossProfit);
  const netIncome = latest(series.trailingNetIncome);

  const price = meta.regularMarketPrice || lastValue(prices);
  const previousClose = meta.previousClose || meta.chartPreviousClose;
  const change = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
  const changePercent = Number.isFinite(change) && previousClose ? (change / previousClose) * 100 : null;

  return {
    company: {
      symbol: primary.symbol,
      name: meta.longName || meta.shortName || primary.name,
      exchange: meta.fullExchangeName || primary.exchange,
      industry: primary.industry,
      currency: meta.currency || 'USD'
    },
    matches,
    metrics: {
      price,
      change,
      changePercent,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      totalRevenue: revenue ? revenue.value : null,
      totalRevenueDate: revenue ? revenue.date : null,
      grossProfit: grossProfit ? grossProfit.value : null,
      netIncome: netIncome ? netIncome.value : null,
      netIncomeDate: netIncome ? netIncome.date : null
    },
    charts: {
      price: toChart(prices, 'price'),
      volume: toChart(volumes, 'volume'),
      quarterlyRevenue: toChart(series.quarterlyTotalRevenue || [], 'money'),
      netIncome: toChart(series.quarterlyNetIncome || [], 'money')
    },
    warning: fundamentalsResult.status === 'rejected'
      ? 'Financial statement data was unavailable for this company, so price and volume charts are shown with blank financial cards.'
      : null
  };
}

async function searchCompanies(query) {
  const search = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`);
  const localMatches = boostedCompanies.filter((company) => companyMatchesQuery(company, query));
  const matches = (search.quotes || [])
    .filter((quote) => quote.quoteType === 'EQUITY' && quote.symbol)
    .map((quote) => ({
      symbol: quote.symbol,
      name: quote.longname || quote.shortname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || 'Exchange',
      industry: quote.industryDisp || quote.industry || quote.sectorDisp || ''
    }));

  const aliasSymbol = aliasSymbols.get(query.trim().toLowerCase());
  if (aliasSymbol && !matches.some((match) => match.symbol === aliasSymbol)) {
    const boosted = boostedCompanies.find((company) => company.symbol === aliasSymbol);
    matches.unshift(boosted || {
      symbol: aliasSymbol,
      name: aliasSymbol,
      exchange: aliasSymbol.endsWith('.NS') ? 'NSE' : 'Exchange',
      industry: ''
    });
  }

  return orderMatches(dedupeMatches([...localMatches, ...matches]), query);
}

async function fetchChart(symbol) {
  const ranges = [
    'range=1y&interval=1mo&events=history',
    'range=6mo&interval=1wk&events=history',
    'range=3mo&interval=1d&events=history'
  ];

  let lastError = null;
  for (const range of ranges) {
    try {
      const chart = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${range}`);
      const result = chart.chart && chart.chart.result && chart.chart.result[0];
      const timestamps = result && result.timestamp;
      if (Array.isArray(timestamps) && timestamps.length) {
        return chart;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No chart data returned.');
}

function dedupeMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    if (seen.has(match.symbol)) return false;
    seen.add(match.symbol);
    return true;
  });
}

function orderMatches(matches, query) {
  const normalized = query.trim().toLowerCase();
  const isIndianQuery = INDIAN_QUERY_HINTS.some((hint) => normalized.includes(hint));

  return [...matches].sort((a, b) => {
    const aAlias = aliasSymbols.get(normalized) === a.symbol ? 1 : 0;
    const bAlias = aliasSymbols.get(normalized) === b.symbol ? 1 : 0;
    if (aAlias !== bAlias) return bAlias - aAlias;

    if (isIndianQuery) {
      const aIndia = isIndianListing(a) ? 1 : 0;
      const bIndia = isIndianListing(b) ? 1 : 0;
      if (aIndia !== bIndia) return bIndia - aIndia;
    }

    const aExact = exactishMatch(a, normalized) ? 1 : 0;
    const bExact = exactishMatch(b, normalized) ? 1 : 0;
    return bExact - aExact;
  });
}

function isIndianListing(match) {
  return match.symbol.endsWith('.NS') || match.symbol.endsWith('.BO') || ['NSE', 'Bombay', 'BSE'].includes(match.exchange);
}

function exactishMatch(match, normalized) {
  return match.symbol.toLowerCase() === normalized || match.name.toLowerCase().includes(normalized);
}

function companyMatchesQuery(company, query) {
  const normalized = query.trim().toLowerCase();
  const haystack = `${company.symbol} ${company.name} ${company.industry}`.toLowerCase();
  return normalized.length >= 2 && haystack.includes(normalized);
}

function serveStatic(pathname, res) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, normalized);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const type = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      ...corsHeaders()
    });
    res.end(data);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 CompanyDashboard/1.0',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Market API request failed with status ${response.status}.`);
  }

  return response.json();
}

function parseFundamentals(payload) {
  const output = {};
  const results = payload.timeseries && payload.timeseries.result ? payload.timeseries.result : [];

  results.forEach((item) => {
    const type = item.meta && item.meta.type ? item.meta.type[0] : null;
    if (!type || !Array.isArray(item[type])) return;

    output[type] = item[type]
      .map((entry) => ({
        label: formatDate(entry.asOfDate),
        date: entry.asOfDate,
        value: entry.reportedValue ? entry.reportedValue.raw : null
      }))
      .filter((entry) => Number.isFinite(entry.value));
  });

  return output;
}

function zipSeries(timestamps, values) {
  return timestamps
    .map((timestamp, index) => ({
      label: formatDate(new Date(timestamp * 1000).toISOString().slice(0, 10)),
      value: values[index]
    }))
    .filter((entry) => Number.isFinite(entry.value));
}

function toChart(series) {
  const clean = (series || []).slice(-12);
  return {
    labels: clean.map((item) => item.label),
    values: clean.map((item) => item.value)
  };
}

function latest(series) {
  return series && series.length ? series[series.length - 1] : null;
}

function lastValue(series) {
  const item = latest(series);
  return item ? item.value : null;
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders()
  });
  res.end(JSON.stringify(data));
}

function sendCors(res) {
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
