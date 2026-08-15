function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab[data-tab="' + name + '"]').classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}
function toggleDetail(btn, idx) {
  var row = document.getElementById('detail-' + idx);
  if (row.classList.contains('show')) {
    row.classList.remove('show');
    btn.textContent = '▶ 展开';
  } else {
    row.classList.add('show');
    btn.textContent = '▼ 收起';
  }
}
function filterThreads() {
  var q = document.getElementById('thread-search').value.toLowerCase();
  document.querySelectorAll('#threads-tbody tr.row-main').forEach(function(row) {
    var text = row.textContent.toLowerCase();
    row.style.display = q ? (text.includes(q) ? '' : 'none') : '';
    var detailRow = row.nextElementSibling;
    if (detailRow && detailRow.classList.contains('detail-row')) {
      detailRow.style.display = row.style.display;
    }
  });
}
function filterGroups() {
  var q = document.getElementById('group-search').value.toLowerCase();
  document.querySelectorAll('#groups-tbody tr').forEach(function(row) {
    row.style.display = q ? (row.textContent.toLowerCase().includes(q) ? '' : 'none') : '';
  });
}
// 火焰图悬浮提示
(function() {
  var tip = document.getElementById('flame-tooltip');
  if (!tip) return;
  document.querySelectorAll('.flame-rect').forEach(function(rect) {
    rect.addEventListener('mousemove', function(e) {
      var sig = rect.getAttribute('data-sig') || '';
      var count = rect.getAttribute('data-count') || '0';
      tip.innerHTML = sig.replace(/\n/g, '<br>') + '<br><span class="tt-count">覆盖 ' + count + ' 个线程</span>';
      tip.style.display = 'block';
      var x = e.clientX + 14, y = e.clientY + 14;
      var r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 10) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 10) y = e.clientY - r.height - 14;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    rect.addEventListener('mouseleave', function() {
      tip.style.display = 'none';
    });
  });
})();
// 火焰图栈名标签显隐开关
function toggleFlameLabels() {
  var show = document.getElementById('flame-label-toggle').checked;
  document.querySelectorAll('.flame-label').forEach(function(t) {
    if (show) t.classList.add('show');
    else t.classList.remove('show');
  });
}
// 火焰图搜索高亮
function filterFlame() {
  var q = document.getElementById('flame-search').value.trim().toLowerCase();
  document.querySelectorAll('.flame-rect').forEach(function(rect) {
    var sig = (rect.getAttribute('data-sig') || '').toLowerCase();
    if (!q) {
      rect.style.opacity = '1';
    } else if (sig.indexOf(q) !== -1) {
      rect.style.opacity = '1';
      rect.setAttribute('stroke', '#ff4d4f');
      rect.setAttribute('stroke-width', '1.5');
    } else {
      rect.style.opacity = '0.15';
      rect.removeAttribute('stroke');
      rect.removeAttribute('stroke-width');
    }
  });
}
