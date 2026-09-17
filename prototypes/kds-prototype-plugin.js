return {
  apply(ctx) {
    const h = React.createElement;
    const row = (label, value) => h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' } },
      h('span', { style: { color: '#888' } }, label), h('span', null, value));

    const SWATCHES = {
      dinein: ['#1a3a2a', '#1a2a3a', '#3a2a1a', '#2a1a3a', '#1a2a2a', '#2a3a1a'],
      takeaway: ['#2a2a35', '#353535', '#2a3035', '#352a2a', '#2a352a', '#303030'],
      rush: ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#22c55e', '#ec4899'],
    };
    const DEFAULT_COLORS = { dinein: '#1a3a2a', takeaway: '#2a2a35', rush: '#ef4444' };
    const LABELS = { dinein: 'Dine-in', takeaway: 'Takeaway', rush: 'Rush badge' };

    function cooldown(fn, ms) { let last = 0; return function() { const now = Date.now(); if (now - last < ms) return; last = now; return fn.apply(this, arguments); }; }

    function KdsPrototype() {
      const [tab, setTab] = React.useState('open');
      const [colors, setColors] = React.useState(DEFAULT_COLORS);
      const [showMenu, setShowMenu] = React.useState(false);
      const [orders, setOrders] = React.useState([
        {
          id: '1', display: '12', table: 'T5', customer: 'John Smith', time: '14:32', priority: true, dineIn: true, status: 'processing',
          notes: 'No onions on steak',
          categories: [
            { course: 'Appetizers', items: [
              { id: 'i1', name: 'Calamari', qty: 2, done: true, doneAt: '14:35', note: '' },
              { id: 'i2', name: 'Bruschetta', qty: 1, done: true, doneAt: '14:36', note: '' },
              { id: 'i3', name: 'Garlic Bread', qty: 1, done: false, doneAt: null, note: 'no garlic, extra butter' },
            ] },
            { course: 'Mains', items: [
              { id: 'i4', name: 'Steak A', qty: 3, done: true, doneAt: '14:38', note: 'medium rare' },
              { id: 'i5', name: 'Spaghetti', qty: 2, done: false, doneAt: null, note: '' },
            ] },
            { course: 'Drinks', items: [
              { id: 'i6', name: 'Drink X', qty: 4, done: false, doneAt: null, note: '' },
              { id: 'i7', name: 'Drink Y', qty: 2, done: false, doneAt: null, note: '' },
            ] },
          ],
        },
        {
          id: '2', display: '8', table: null, customer: 'Jane Doe', time: '14:41', priority: false, dineIn: false, status: 'processing',
          notes: '',
          categories: [
            { course: 'Mains', items: [
              { id: 'i8', name: 'Grilled Chicken', qty: 2, done: false, doneAt: null, note: '' },
              { id: 'i9', name: 'Rice', qty: 2, done: false, doneAt: null, note: '' },
            ] },
            { course: 'Drinks', items: [
              { id: 'i10', name: 'Soda', qty: 2, done: false, doneAt: null, note: '' },
            ] },
          ],
        },
        {
          id: '3', display: '5', table: 'T2', customer: 'Alice Wang', time: '14:47', priority: false, dineIn: true, status: 'paused',
          notes: '',
          categories: [
            { course: 'Appetizers', items: [
              { id: 'i11', name: 'Spring Rolls', qty: 4, done: true, doneAt: '14:49', note: '' },
              { id: 'i12', name: 'Dumplings', qty: 6, done: true, doneAt: '14:50', note: 'steamed' },
            ] },
            { course: 'Mains', items: [
              { id: 'i13', name: 'Beef Noodles', qty: 2, done: false, doneAt: null, note: '' },
            ] },
          ],
        },
      ]);

      const toggleItem = (orderId, ci, ii) => setOrders(prev => prev.map(o => {
        if (o.id !== orderId) return o;
        return { ...o, categories: o.categories.map((cat, x) => x !== ci ? cat : { ...cat, items: cat.items.map((it, y) => y !== ii ? it : { ...it, done: !it.done, doneAt: !it.done ? 'now' : null }) }) };
      }));
      const toggleItemC = cooldown(toggleItem, 200);

      const toggleCat = (orderId, ci) => setOrders(prev => prev.map(o => {
        if (o.id !== orderId) return o;
        return { ...o, categories: o.categories.map((cat, x) => {
          if (x !== ci) return cat;
          const all = cat.items.every(i => i.done);
          return { ...cat, items: cat.items.map(it => ({ ...it, done: !all, doneAt: !all ? 'now' : null })) };
        }) };
      }));
      const toggleCatC = cooldown(toggleCat, 200);

      const advance = (orderId) => setOrders(prev => prev.map(o => o.id !== orderId ? o : {
        ...o, status: o.status === 'processing' ? 'paused' : o.status === 'paused' ? 'processing' : o.status,
      }));
      const advanceC = cooldown(advance, 200);
      const complete = (orderId) => setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'completed' } : o));
      const reopen = (orderId) => setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'paused' } : o));

      const open = orders.filter(o => o.status !== 'completed');
      const done = orders.filter(o => o.status === 'completed');

      const card = (o) => {
        const allDone = o.categories.every(c => c.items.every(i => i.done));
        const remaining = o.categories.reduce((s, c) => s + c.items.filter(i => !i.done).length, 0);
        const hdrBg = o.dineIn ? colors.dinein : colors.takeaway;
        return h('div', { key: o.id, style: { display: 'flex', flexDirection: 'column', background: '#181825', borderRadius: 8, border: '1px solid #2a2a35', overflow: 'hidden', height: 'fit-content' } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: hdrBg } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { fontWeight: 700 } }, '#' + o.display),
              o.table && h('span', { style: { color: '#999' } }, '\u00B7 ' + o.table),
              h('span', null, '\u00B7 ' + o.customer),
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              o.priority && h('span', { style: { background: colors.rush, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 } }, 'RUSH'),
              h('span', { style: { color: '#aaa', fontSize: 12 } }, o.time),
            ),
          ),
          h('div', { style: { padding: '2px 0', maxHeight: 240, overflowY: 'auto' } },
            o.categories.map((cat, ci) => h('div', { key: ci, style: { borderBottom: '1px solid #222230', padding: '4px 0' } },
              h('button', { style: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', border: 'none', background: 'transparent', color: '#ccc', cursor: 'pointer', textAlign: 'left' }, onClick: () => toggleCatC(o.id, ci) },
                h('span', { style: { fontWeight: 600 } }, cat.course),
                h('span', null,
                  h('span', { style: { color: '#666', fontSize: 11 } }, cat.items.filter(i => i.done).length + '/' + cat.items.length),
                  cat.items.every(i => i.done) && h('span', { style: { color: '#4ade80', marginLeft: 4 } }, '\u2713'),
                ),
              ),
              cat.items.map((it, ii) => h('div', { key: it.id },
                h('button', { style: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 12px', border: 'none', background: 'transparent', color: '#d0d0d0', cursor: 'pointer', textAlign: 'left' }, onClick: () => toggleItemC(o.id, ci, ii) },
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('span', { style: { width: 14, height: 14, borderRadius: 3, border: '1.5px solid ' + (it.done ? '#4ade80' : '#555'), background: it.done ? '#4ade80' : 'transparent', color: it.done ? '#0f0f14' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 } }, '\u2713'),
                    h('span', { style: { color: '#888', fontSize: 11 } }, it.qty + '\u00D7'),
                    h('span', null, it.name),
                  ),
                  it.done && it.doneAt && h('span', { style: { color: '#555', fontSize: 10 } }, it.doneAt + ' \u00B7 9m'),
                ),
                it.note && h('div', { style: { color: '#666', fontStyle: 'italic', fontSize: 11, padding: '0 12px 3px 26px' } }, it.note),
              )),
            )),
            o.notes && h('div', { style: { color: '#888', fontStyle: 'italic', fontSize: 11, padding: '5px 12px', borderTop: '1px solid #222230' } }, 'Notes: "' + o.notes + '"'),
          ),
          h('div', { style: { padding: '6px 10px' } },
            o.status === 'paused'
              ? h('button', { style: { width: '100%', padding: '6px 0', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer' }, onClick: () => advanceC(o.id) }, 'Resume')
              : allDone
                ? h('button', { style: { width: '100%', padding: '6px 0', borderRadius: 6, border: 'none', background: '#4ade80', color: '#0f0f14', fontWeight: 600, cursor: 'pointer' }, onClick: () => complete(o.id) }, 'Mark Completed')
                : h('button', { style: { width: '100%', padding: '6px 0', borderRadius: 6, border: 'none', background: '#2a2a35', color: '#555', fontWeight: 600, cursor: 'not-allowed' }, onClick: () => { if (window.confirm(remaining + ' items still unchecked \u2014 override?')) complete(o.id); } }, remaining + ' items remaining'),
          ),
        );
      };

      const completedRow = (o) => h('div', { key: o.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#181825', borderRadius: 6, border: '1px solid #2a2a35' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontWeight: 600 } }, '#' + o.display),
          o.table && h('span', { style: { color: '#666' } }, '\u00B7 ' + o.table),
          h('span', null, '\u00B7 ' + o.customer),
          h('span', { style: { color: '#666' } }, o.time + ' \u00B7 in 12 min 25s'),
        ),
        h('button', { style: { padding: '3px 10px', borderRadius: 4, border: '1px solid #3a3a50', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 11 }, onClick: () => reopen(o.id) }, 'Reopen'),
      );

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: 500, background: '#0f0f14', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif', fontSize: 13, overflow: 'hidden', borderRadius: 10, border: '1px solid #2a2a35', userSelect: 'none' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#1a1a25', borderBottom: '1px solid #2a2a35' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', null, '\u{1F373}'), h('span', { style: { fontWeight: 700 } }, 'Kitchen Display'),
          ),
          h('div', { style: { display: 'flex', gap: 4 } },
            h('button', { style: { padding: '4px 14px', borderRadius: 6, border: 'none', background: tab === 'open' ? '#3a3a50' : 'transparent', color: tab === 'open' ? '#fff' : '#888', cursor: 'pointer' }, onClick: () => setTab('open') }, 'Open', h('span', { style: { marginLeft: 4, color: '#888' } }, open.length)),
            h('button', { style: { padding: '4px 14px', borderRadius: 6, border: 'none', background: tab === 'completed' ? '#3a3a50' : 'transparent', color: tab === 'completed' ? '#fff' : '#888', cursor: 'pointer' }, onClick: () => setTab('completed') }, 'Completed', h('span', { style: { marginLeft: 4, color: '#888' } }, done.length)),
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, position: 'relative' } },
            h('span', { style: { width: 8, height: 8, borderRadius: 4, background: '#4ade80' } }),
            h('button', { style: { width: 30, height: 30, borderRadius: 6, border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 16 }, onClick: () => setShowMenu(p => !p) }, '\u2630'),
            showMenu && h('div', { style: { position: 'absolute', top: '100%', right: 0, width: 220, background: '#1a1a25', border: '1px solid #2a2a35', borderRadius: 8, padding: 12, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: '#aaa', marginBottom: 8 } }, 'Card Colours'),
              ['dinein', 'takeaway', 'rush'].map(k => h('div', { key: k, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
                h('span', { style: { fontSize: 11, color: '#888' } }, LABELS[k]),
                h('div', { style: { display: 'flex', gap: 4 } }, SWATCHES[k].map(s => h('div', { key: s, style: { width: 20, height: 20, borderRadius: 4, border: '2px solid ' + (colors[k] === s ? '#fff' : 'transparent'), background: s, cursor: 'pointer' }, onClick: () => setColors(prev => ({ ...prev, [k]: s })) }))),
              )),
              h('button', { style: { width: '100%', padding: 5, borderRadius: 4, border: '1px solid #3a3a50', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 11 }, onClick: () => setColors(DEFAULT_COLORS) }, 'Reset to defaults'),
            ),
          ),
        ),
        tab === 'open'
          ? h('div', { style: { flex: 1, overflowY: 'auto', minHeight: 0, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, alignContent: 'start' } },
              open.length === 0 ? h('div', { style: { gridColumn: '1 / -1', textAlign: 'center', color: '#555', padding: '40px 0' } }, 'No open orders')
              : open.map(card),
            )
          : h('div', { style: { flex: 1, overflowY: 'auto', minHeight: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 } },
              done.length === 0 ? h('div', { style: { textAlign: 'center', color: '#555', padding: '40px 0' } }, 'No completed orders yet')
              : done.map(completedRow),
            ),
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '2px 14px', color: '#555', fontSize: 11, borderTop: '1px solid #1a1a22' } },
          h('span', null, '192.168.1.42'), h('span', null, '|'), h('span', null, '14 Aug 14:55'), h('span', null, '|'), h('span', null, 'Last synced: 2s ago'), h('span', null, '|'), h('span', { style: { color: '#4ade80' } }, 'Connected'),
        ),
      );
    }

    return {
      apply(ctx) {
        const slots = ctx.get('slots');
        if (slots === undefined) return;
        slots.inject('tool.view.cordis', () => slots.register(
          { name: 'tool.view.cordis', key: 'self' },
          (props) => React.createElement(KdsPrototype, null),
        ));
      }
    };
  }
}