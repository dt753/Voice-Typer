const fs = require('fs');
let html = fs.readFileSync('src/renderer/settings.html', 'utf-8');

// Remove the standalone init() call (we'll call it inside initExtra)
html = html.replace('  init();\n\n  // ── Tabs', '  // ── Tabs');

const newJS = `
  // ── Replacements ──────────────────────────────────────────────────────────
  let replacements = [];

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderReplacements() {
    const list = document.getElementById('replacementsList');
    if (replacements.length === 0) {
      list.innerHTML = '<div style="color:#6c7086;font-size:13px;padding:8px 0">Замен пока нет.</div>';
      return;
    }
    list.innerHTML = replacements.map((r, i) => {
      const checked = r.preserveCase ? 'checked' : '';
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">' +
        '<input type="text" placeholder="Что заменять" value="' + escHtml(r.from) + '"' +
        ' oninput="replacements[' + i + '].from=this.value"' +
        ' style="flex:1;padding:8px 10px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;font-size:13px;outline:none" />' +
        '<span style="color:#6c7086;flex-shrink:0">→</span>' +
        '<input type="text" placeholder="На что заменять" value="' + escHtml(r.to) + '"' +
        ' oninput="replacements[' + i + '].to=this.value"' +
        ' style="flex:1;padding:8px 10px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;font-size:13px;outline:none" />' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#a6adc8;white-space:nowrap">' +
        '<input type="checkbox" ' + checked + ' onchange="replacements[' + i + '].preserveCase=this.checked" /> Регистр</label>' +
        '<button onclick="replacements.splice(' + i + ',1);renderReplacements()"' +
        ' style="padding:4px 10px;background:transparent;border:1px solid #f38ba820;border-radius:6px;color:#f38ba8;cursor:pointer;font-size:12px">✕</button>' +
        '</div>';
    }).join('');
  }

  document.getElementById('addReplacement').addEventListener('click', () => {
    replacements.push({ from: '', to: '', preserveCase: true });
    renderReplacements();
  });

  document.getElementById('saveReplacements').addEventListener('click', async () => {
    const s = await window.api.getSettings();
    await window.api.saveSettings({ ...s, replacements });
    const msg = document.getElementById('savedReplacementsMsg');
    msg.textContent = '✓ Сохранено';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });

  // ── Instructions ──────────────────────────────────────────────────────────
  document.getElementById('saveInstructions').addEventListener('click', async () => {
    const s = await window.api.getSettings();
    const customInstructions = document.getElementById('customInstructions').value.trim();
    const dictionary = document.getElementById('dictionary').value
      .split('\\n').map(w => w.trim()).filter(Boolean);
    await window.api.saveSettings({ ...s, customInstructions, dictionary });
    const msg = document.getElementById('savedInstructionsMsg');
    msg.textContent = '✓ Сохранено';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });

  // ── Init with extras ───────────────────────────────────────────────────────
  async function initAll() {
    await init();
    const s = await window.api.getSettings();
    replacements = (s.replacements || []).map(r => ({ ...r }));
    renderReplacements();
    document.getElementById('customInstructions').value = s.customInstructions || '';
    document.getElementById('dictionary').value = (s.dictionary || []).join('\\n');
  }
  initAll();
`;

html = html.replace('</script>\n</body>', newJS + '\n</script>\n</body>');

fs.writeFileSync('src/renderer/settings.html', html, 'utf-8');
console.log('JS added successfully');
