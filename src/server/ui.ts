/**
 * Inline web UI served as a single HTML page. No external dependencies.
 */
export const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jeopardy RAG</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0e27; color: #e0e0e0; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #1a1a6e, #060ce9); padding: 20px; text-align: center; border-bottom: 4px solid #d4a017; }
  .header h1 { color: #d4a017; font-size: 2em; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
  .header p { color: #a0a0d0; margin-top: 4px; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
  .tab { padding: 10px 20px; background: #1a1a4e; border: 1px solid #333; border-radius: 8px 8px 0 0; cursor: pointer; color: #a0a0d0; }
  .tab.active { background: #2a2a6e; color: #d4a017; border-bottom-color: #2a2a6e; }
  .panel { display: none; }
  .panel.active { display: block; }
  .input-group { display: flex; gap: 10px; margin-bottom: 20px; }
  input[type="text"] { flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid #444; background: #1a1a3e; color: #fff; font-size: 16px; }
  input[type="text"]::placeholder { color: #666; }
  button { padding: 12px 24px; border-radius: 8px; border: none; background: #060ce9; color: #fff; font-size: 16px; cursor: pointer; }
  button:hover { background: #0810ff; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .answer-box { background: #1a1a3e; border-radius: 8px; padding: 20px; margin-bottom: 15px; border: 1px solid #333; white-space: pre-wrap; line-height: 1.6; }
  .meta { display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 15px; }
  .meta-item { background: #2a2a5e; padding: 6px 12px; border-radius: 6px; font-size: 13px; }
  .meta-item strong { color: #d4a017; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
  .stat-card { background: #1a1a3e; border-radius: 8px; padding: 20px; text-align: center; border: 1px solid #333; }
  .stat-card .value { font-size: 2em; color: #d4a017; font-weight: bold; }
  .stat-card .label { color: #a0a0d0; margin-top: 4px; }
  .cat-list { list-style: none; }
  .cat-list li { background: #1a1a3e; margin-bottom: 8px; padding: 12px 16px; border-radius: 8px; border: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
  .cat-list .cat-name { color: #d4a017; font-weight: bold; }
  .cat-list .cat-count { color: #888; font-size: 13px; }
  .cat-list .cat-summary { color: #a0a0d0; font-size: 13px; margin-top: 4px; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #444; border-top-color: #d4a017; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .export-link { color: #060ce9; text-decoration: underline; cursor: pointer; font-size: 13px; }
  .session-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; color: #888; }
  .session-bar code { background: #1a1a3e; padding: 2px 8px; border-radius: 4px; color: #d4a017; }
</style>
</head>
<body>
<div class="header">
  <h1>JEOPARDY RAG</h1>
  <p>Hierarchical Retrieval System</p>
</div>
<div class="container">
  <div class="tabs">
    <div class="tab active" data-tab="ask">Ask</div>
    <div class="tab" data-tab="categories">Categories</div>
    <div class="tab" data-tab="stats">Stats</div>
  </div>

  <div id="ask" class="panel active">
    <div class="session-bar">
      Session: <code id="sessionId"></code>
      <button onclick="newSession()" style="padding:4px 8px;font-size:12px;background:#444;">New Session</button>
    </div>
    <div class="input-group">
      <input type="text" id="questionInput" placeholder="Ask about Jeopardy... e.g. 'Quiz me on hard science questions'" />
      <button id="askBtn" onclick="askQuestion()">Ask</button>
    </div>
    <div id="askMeta" class="meta" style="display:none;"></div>
    <div id="askAnswer" class="answer-box" style="display:none;"></div>
    <div id="askExport" style="display:none;margin-bottom:15px;">
      <span class="export-link" onclick="exportCsv()">Export results as CSV</span>
    </div>
  </div>

  <div id="categories" class="panel">
    <div class="input-group">
      <input type="text" id="catSearch" placeholder="Search categories..." oninput="searchCats()" />
    </div>
    <ul class="cat-list" id="catList"></ul>
    <button id="catMore" onclick="loadMoreCats()" style="display:none;width:100%;margin-top:10px;">Load more</button>
  </div>

  <div id="stats" class="panel">
    <div class="stats-grid" id="statsGrid"></div>
  </div>
</div>

<script>
let sid = localStorage.getItem('jeopardy_session') || crypto.randomUUID();
localStorage.setItem('jeopardy_session', sid);
document.getElementById('sessionId').textContent = sid.slice(0, 8);

let lastResult = null;
let catOffset = 0;
let catQuery = '';

function newSession() {
  sid = crypto.randomUUID();
  localStorage.setItem('jeopardy_session', sid);
  document.getElementById('sessionId').textContent = sid.slice(0, 8);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'stats') loadStats();
    if (tab.dataset.tab === 'categories') { catOffset = 0; searchCats(); }
  });
});

document.getElementById('questionInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') askQuestion();
});

async function askQuestion() {
  const input = document.getElementById('questionInput');
  const q = input.value.trim();
  if (!q) return;
  const btn = document.getElementById('askBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  document.getElementById('askAnswer').style.display = 'block';
  document.getElementById('askAnswer').textContent = 'Thinking...';
  document.getElementById('askMeta').style.display = 'none';
  document.getElementById('askExport').style.display = 'none';

  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, sessionId: sid }),
    });
    const data = await res.json();
    if (res.ok) {
      lastResult = data;
      document.getElementById('askAnswer').textContent = data.answer;
      document.getElementById('askMeta').style.display = 'flex';
      document.getElementById('askMeta').innerHTML =
        '<div class="meta-item"><strong>Categories:</strong> ' + data.categories.join(', ') + '</div>' +
        (data.whereClause ? '<div class="meta-item"><strong>Filter:</strong> ' + data.whereClause + '</div>' : '') +
        '<div class="meta-item"><strong>Found:</strong> ' + data.questionsFound + ' questions</div>' +
        '<div class="meta-item"><strong>Time:</strong> ' + data.durationMs + 'ms</div>';
      document.getElementById('askExport').style.display = 'block';
    } else {
      document.getElementById('askAnswer').textContent = 'Error: ' + (data.error || 'Unknown error');
    }
  } catch (err) {
    document.getElementById('askAnswer').textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = 'Ask';
}

async function searchCats() {
  catQuery = document.getElementById('catSearch').value.trim();
  catOffset = 0;
  const list = document.getElementById('catList');
  list.innerHTML = '';
  await loadMoreCats();
}

async function loadMoreCats() {
  try {
    const params = new URLSearchParams({ limit: '30', offset: String(catOffset) });
    if (catQuery) params.set('search', catQuery);
    const res = await fetch('/registry?' + params);
    const data = await res.json();
    const list = document.getElementById('catList');
    for (const cat of data) {
      const li = document.createElement('li');
      li.innerHTML = '<div><span class="cat-name">' + esc(cat.category) + '</span>' +
        (cat.summary ? '<div class="cat-summary">' + esc(cat.summary) + '</div>' : '') +
        '</div>' +
        '<div class="cat-count">' + cat.question_count + ' questions' +
        (cat.rounds ? '<br>' + esc(cat.rounds) : '') + '</div>';
      list.appendChild(li);
    }
    catOffset += data.length;
    document.getElementById('catMore').style.display = data.length >= 30 ? 'block' : 'none';
  } catch (err) { console.error(err); }
}

async function loadStats() {
  try {
    const res = await fetch('/stats');
    const data = await res.json();
    document.getElementById('statsGrid').innerHTML =
      stat(data.totalQuestions.toLocaleString(), 'Total Questions') +
      stat(data.totalCategories.toLocaleString(), 'Categories') +
      stat(data.categoriesEnriched.toLocaleString(), 'Enriched') +
      stat(data.categoriesPendingEnrichment.toLocaleString(), 'Pending Enrichment') +
      stat(data.dateRange.min || 'N/A', 'Earliest Date') +
      stat(data.dateRange.max || 'N/A', 'Latest Date');
  } catch (err) { console.error(err); }
}

function stat(v, l) {
  return '<div class="stat-card"><div class="value">' + v + '</div><div class="label">' + l + '</div></div>';
}

function exportCsv() {
  if (!lastResult) return;
  window.open('/export?' + new URLSearchParams({
    categories: lastResult.categories.join(','),
    whereClause: lastResult.whereClause || '',
  }));
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Auto-load categories on page load
searchCats();
</script>
</body>
</html>`;
