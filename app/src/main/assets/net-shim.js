// claude.ai'ye özgü window.claude.use('room') arayüzünü PeerJS (WebRTC) ile taklit eder.
// İki oyunculu oda: ilk giren oda kodunu "kayıt eder", ikinci giren ona bağlanır.
(function () {
  if (window.claude && window.claude.use) return;

  function makeRoom(roomName) {
    var hostId = 'fonksiyon-arena-' + roomName;
    var st = { peer: null, conn: null, myId: '', myPres: {}, remotePres: null, cb: null, errCb: null, dead: false, retried: false };

    function emit() {
      if (!st.cb || st.dead) return;
      var peers = [{ kind: 'viewer', sameTab: true, isMe: true, peer: st.myId, presence: st.myPres }];
      if (st.conn && st.conn.open) {
        peers.push({ kind: 'viewer', sameTab: false, isMe: false, peer: st.conn.peer, presence: st.remotePres || {} });
      }
      try { st.cb({ peers: peers }); } catch (e) {}
    }
    function fail(type) { if (st.errCb) { try { st.errCb({ code: type }); } catch (e) {} } }

    function attach(c) {
      c.on('open', function () {
        if (st.conn && st.conn !== c && st.conn.open) { c.close(); return; } // oda dolu
        st.conn = c; st.remotePres = null;
        try { c.send(st.myPres); } catch (e) {}
        emit();
      });
      c.on('data', function (d) { if (st.conn === c) { st.remotePres = d; emit(); } });
      c.on('close', function () { if (st.conn === c) { st.conn = null; st.remotePres = null; emit(); } });
      c.on('error', function () { if (st.conn === c) { st.conn = null; st.remotePres = null; emit(); } });
    }

    function start(resolveFn, rejectFn) {
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; rejectFn(new Error('timeout')); } }, 12000);
      function ok() { if (!settled) { settled = true; clearTimeout(timer); resolveFn(api); } }
      function bad(e) { if (!settled) { settled = true; clearTimeout(timer); rejectFn(e); } else fail(e && e.type); }

      var p = new Peer(hostId);
      st.peer = p;
      p.on('open', function (id) { st.myId = id; ok(); });
      p.on('connection', function (c) { attach(c); });
      p.on('error', function (err) {
        if (err.type === 'unavailable-id') {
          // Oda zaten açık: misafir olarak bağlan
          var g = new Peer();
          st.peer = g;
          g.on('open', function (id) {
            st.myId = id; ok();
            attach(g.connect(hostId, { reliable: true }));
          });
          g.on('error', function (e2) {
            if (e2.type === 'peer-unavailable' && !st.retried && !st.dead) {
              // Ev sahibi gitmiş: odayı biz açalım
              st.retried = true; try { g.destroy(); } catch (x) {}
              start(function () {}, function () {});
            } else bad(e2);
          });
        } else bad(err);
      });
    }

    var api = {
      presence: function (pr) {
        st.myPres = pr;
        if (st.conn && st.conn.open) { try { st.conn.send(pr); } catch (e) {} }
        return Promise.resolve();
      },
      onPeers: function (cb, errCb) { st.cb = cb; st.errCb = errCb; emit(); },
      leave: function () {
        st.dead = true;
        try { if (st.conn) st.conn.close(); } catch (e) {}
        try { if (st.peer) st.peer.destroy(); } catch (e) {}
        return Promise.resolve();
      }
    };
    api._start = start;
    return api;
  }

  window.claude = {
    use: function (name) {
      if (name !== 'room' || typeof Peer === 'undefined') return Promise.resolve(null);
      return Promise.resolve({
        join: function (roomName) {
          return new Promise(function (resolve, reject) {
            var r = makeRoom(roomName);
            r._start(resolve, reject);
          });
        }
      });
    }
  };
})();
