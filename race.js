(() => {
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const overlay = document.querySelector('#overlay');
  const dialog = overlay.querySelector('.dialog');
  const scoreEl = document.querySelector('#score');
  const distanceEl = document.querySelector('#lives');
  const statusEl = document.querySelector('#race-status');
  const progressBar = document.querySelector('#distance-bar');
  const progressFill = document.querySelector('#distance-fill');
  const pauseButton = document.querySelector('#pause');
  const micButton = document.querySelector('#mic');
  const micStatus = document.querySelector('#mic-status');
  const W = 960, H = 540, floorY = 448;
  const keys = { left: false, right: false, jump: false };
  const colors = ['#e87957', '#65c5bd', '#e0c566', '#b28bd2', '#79bd79'];
  const labels = { fly: 'أجنحة القمر', slow: 'لمسة الإبطاء', dash: 'اندفاعة البرق' };
  const descriptions = {
    fly: 'تحليق فوق الحفر لمدة ٥ ثوانٍ.',
    slow: 'المس منافساً لإبطائه ٣ ثوانٍ.',
    dash: 'سرعة إضافية لمدة ٤ ثوانٍ.'
  };
  let state = 'menu', mode = 'solo', role = 'solo', mapLength = 5200, worldWidth = mapLength;
  let player, rivals = {}, bots = [], pits = [], platforms = [], boxes = [], cameraX = 0;
  let peer = null, connections = new Map(), roomConnection = null, playerName = 'المتسابق';
  let micStream = null, voiceHeld = false;
  let score = 0, elapsed = 0, countdownUntil = 0, lastTime = 0, lastNetworkSend = 0;
  let winner = null, peerScriptPromise = null, selectedLength = 5200, spectatorId = null;
  const voiceCalls = new Map();
  const number = value => new Intl.NumberFormat('ar').format(value);

  function drawMenu() {
    dialog.innerHTML = `
      <div class="sigil" aria-hidden="true">✦</div>
      <p class="menu-title">سباق منصات تنافسي، كل واحد لنفسه</p>
      <h2>I Will Win Alone</h2>
      <p>سوف أفوز وحدي. اركض، اختر قدرة، ولا تدع الضباب يلحق بك.</p>
      <div class="menu-grid">
        <label class="menu-field">اسمك<input id="player-name" maxlength="18" value="المتسابق" autocomplete="nickname"></label>
        <label class="menu-field">طول الخريطة<select id="map-length"><option value="2400">قصير · ٢٤٠٠</option><option value="5200" selected>طويل · ٥٢٠٠</option><option value="8200">ماراثون · ٨٢٠٠</option></select></label>
      </div>
      <div class="menu-actions">
        <button class="menu-action primary-action" id="solo-game">سباق ضد منافسين آليين</button>
        <button class="menu-action" id="create-room">إنشاء غرفة أونلاين</button>
      </div>
      <div class="menu-grid">
        <label class="menu-field">رمز غرفة الصديق<input id="join-code" placeholder="أدخل الرمز الذي أرسله صديقك" autocomplete="off"></label>
        <button class="menu-action" id="join-room" style="align-self:end">انضم إلى الغرفة</button>
      </div>
      <p class="room-status" id="room-status" aria-live="polite">اختر طول المسار ثم ابدأ السباق أو أنشئ غرفة.</p>
      <div id="host-tools" hidden>
        <label class="menu-field">رمز غرفتك، أرسله لصديقك<input id="host-code" readonly></label>
        <div class="menu-actions" style="margin-top:8px">
          <button class="menu-action" id="copy-code">نسخ الرمز</button>
          <button class="menu-action primary-action" id="start-online" disabled>ابدأ السباق</button>
        </div>
      </div>
      <p class="hint">اللعب عن بُعد يحتاج إنترنت. الأسهم أو أزرار اللمس للحركة والقفز.</p>`;
  }

  function setStatus(text) {
    const target = document.querySelector('#room-status');
    if (target) target.textContent = text;
  }
  function setHeader(name) {
    document.title = 'I Will Win Alone | سوف أفوز وحدي';
    document.querySelector('.brand h1').textContent = 'I Will Win Alone';
    document.querySelector('.subtitle').textContent = 'سوف أفوز وحدي · سباق لا مكان فيه للتعاون';
    document.querySelector('.underbar').innerHTML = '<span><b>الهدف:</b> كن أول من يصل، والضباب يقترب</span><span>الأسهم / A D · قفز: Space</span>';
  }

  function createCourse(length) {
    mapLength = Math.max(1800, Math.min(8500, Number(length) || 5200));
    worldWidth = mapLength;
    pits = []; platforms = []; boxes = [];
    let index = 0;
    for (let start = 420; start < worldWidth - 220; start += 510) {
      const width = 88 + (index % 2) * 22;
      pits.push([start, start + width]);
      const top = 325 + (index % 3) * 17;
      platforms.push([start - 12, start + width + 76, top]);
      if (index % 2 === 1) platforms.push([start + 205, start + 292, 355 - (index % 3) * 12]);
      index++;
    }
    for (let x = 260; x < worldWidth - 180; x += 690) boxes.push({ x, y: 414, collected: false, bob: Math.random() * 5 });
  }

  function makePlayer(id, name, isLocal, x, color) {
    return { id, name, isLocal, x, y: floorY - 40, w: 25, h: 38, vx: 0, vy: 0, grounded: false, color, ability: null, abilityTime: 0, slowTime: 0, lastTag: 0, flying: false };
  }
  function startRace(settings = {}) {
    mode = settings.mode || 'solo';
    if (mode === 'solo') role = 'solo';
    playerName = settings.name || playerName;
    selectedLength = Number(settings.length || document.querySelector('#map-length')?.value || selectedLength);
    createCourse(selectedLength);
    player = makePlayer(mode === 'online' ? (peer?.id || 'host') : 'you', playerName, true, 42, colors[0]);
    if (!(mode === 'online' && role === 'host')) rivals = {};
    else Object.values(rivals).forEach((rival, index) => {
      rival.x = 92 + index * 46; rival.y = floorY - rival.h; rival.vx = 0; rival.vy = 0;
      rival.eliminated = false; rival.ability = null; rival.abilityTime = 0; rival.slowTime = 0;
    });
    bots = [];
    cameraX = 0; score = 0; elapsed = 0; winner = null; spectatorId = null; countdownUntil = performance.now() + 1800;
    if (mode === 'solo') {
      bots = [makePlayer('bot-a', 'ندى', false, 5, colors[1]), makePlayer('bot-b', 'سامي', false, -38, colors[2])];
    }
    if (role === 'host') for (const connection of connections.values()) connection.ready = false;
    state = 'countdown'; overlay.hidden = true;
    statusEl.hidden = false; progressBar.hidden = false;
    statusEl.textContent = 'استعد…';
    pauseButton.textContent = 'Ⅱ';
    updateHud();
    if (mode === 'online') sendToAll({ type: 'start', name: playerName, length: mapLength });
  }

  function startSolo() {
    playerName = document.querySelector('#player-name').value.trim() || 'المتسابق';
    startRace({ mode: 'solo', name: playerName, length: document.querySelector('#map-length').value });
  }

  function loadPeerJs() {
    if (window.Peer) return Promise.resolve();
    if (peerScriptPromise) return peerScriptPromise;
    peerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('تعذر تحميل خدمة اللعب عن بُعد'));
      document.head.append(script);
    });
    return peerScriptPromise;
  }

  async function createRoom() {
    const button = document.querySelector('#create-room');
    button.disabled = true; setStatus('جارٍ الاتصال بخدمة الغرف…');
    playerName = document.querySelector('#player-name').value.trim() || 'المتسابق';
    try {
      await loadPeerJs();
      peer = new Peer(); mode = 'host'; role = 'host'; connections.clear();
      bindPeerVoice(peer);
      peer.on('open', id => {
        document.querySelector('#host-tools').hidden = false;
        document.querySelector('#host-code').value = id;
        document.querySelector('#start-online').disabled = false;
        setStatus('الغرفة جاهزة. أرسل الرمز لصديقك، ثم ابدأ عندما ينضم.');
      });
      peer.on('connection', connection => attachHostConnection(connection));
      peer.on('error', error => {
        setStatus(`تعذر إنشاء الغرفة: ${error.type || error.message}`);
        button.disabled = false;
      });
    } catch (error) { setStatus(`${error.message}. جرّب اتصال الإنترنت أو النمط الفردي.`); button.disabled = false; }
  }

  function attachHostConnection(connection) {
    connection.on('open', () => {
      connections.set(connection.peer, connection);
      setStatus(`انضم متسابق. عدد الأصدقاء: ${number(connections.size)}. أرسل الرمز لمزيد من اللاعبين.`);
    });
    connection.on('data', data => {
      if (data.type === 'join') {
        rivals[connection.peer] = makePlayer(connection.peer, String(data.name || 'صديق').slice(0, 18), false, 0, colors[(connections.size % (colors.length - 1)) + 1]);
        broadcastPlayers();
      }
      if (data.type === 'state' && rivals[connection.peer]) {
        Object.assign(rivals[connection.peer], { x: Number(data.x) || 0, y: Number(data.y) || 0, ability: data.ability || null, abilityTime: Number(data.abilityTime) || 0, slowTime: Number(data.slowTime) || 0 });
        broadcastPlayers();
      }
      if (data.type === 'tag') applyTag(data.target);
      if (data.type === 'finish') declareWinner(String(data.name || 'متسابق'));
      if (data.type === 'eliminated' && rivals[connection.peer]) {
        rivals[connection.peer].eliminated = true;
        broadcastPlayers();
        const active = [player, ...Object.values(rivals)].filter(item => !item.eliminated);
        if (!active.length) endRoundWithoutWinner();
      }
      if (data.type === 'ready') {
        connection.ready = true;
        const readyCount = [...connections.values()].filter(item => item.ready).length;
        setStatus(`${data.name || 'لاعب'} جاهز · ${number(readyCount)} من ${number(connections.size)} جاهزون.`);
      }
    });
    connection.on('close', () => { connections.delete(connection.peer); delete rivals[connection.peer]; broadcastPlayers(); });
  }

  async function joinRoom() {
    const code = document.querySelector('#join-code').value.trim();
    if (!code) { setStatus('اكتب رمز الغرفة الذي أرسله صديقك.'); return; }
    playerName = document.querySelector('#player-name').value.trim() || 'المتسابق';
    setStatus('جارٍ الاتصال بصديقك…');
    try {
      await loadPeerJs();
      peer = new Peer(); mode = 'joining'; role = 'client';
      bindPeerVoice(peer);
      peer.on('open', () => {
        roomConnection = peer.connect(code, { reliable: true });
        roomConnection.on('open', () => {
          mode = 'online'; roomConnection.send({ type: 'join', name: playerName });
          setStatus('اتصلت بالغرفة. انتظر المضيف ليبدأ السباق.');
        });
        roomConnection.on('data', receiveHostMessage);
        roomConnection.on('close', () => setStatus('انقطع اتصال الغرفة.'));
      });
      peer.on('error', error => setStatus(`تعذر الانضمام: ${error.type || error.message}`));
    } catch (error) { setStatus(`${error.message}. جرّب اتصال الإنترنت أو رمزاً آخر.`); }
  }

  function bindPeerVoice(activePeer) {
    activePeer.on('call', call => {
      const existing = voiceCalls.get(call.peer);
      if (existing && existing !== call) existing.close();
      call.voiceDirection = 'incoming';
      voiceCalls.set(call.peer, call);
      call.answer(micStream || undefined);
      call.on('stream', stream => attachRemoteVoice(stream, call.peer));
      call.on('close', () => {
        if (voiceCalls.get(call.peer) === call) {
          voiceCalls.delete(call.peer);
          clearRemoteVoice(call.peer);
        }
      });
    });
  }

  function attachRemoteVoice(stream, peerId) {
    let audio = document.querySelector(`audio[data-voice="${CSS.escape(peerId)}"]`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true; audio.playsInline = true;
      audio.dataset.voice = peerId;
      document.body.append(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => { micStatus.textContent = 'اضغط الصفحة للسماح بتشغيل صوت الأصدقاء.'; });
  }

  function clearRemoteVoice(peerId) {
    const audio = document.querySelector(`audio[data-voice="${CSS.escape(peerId)}"]`);
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
  }

  function voicePeerIds() {
    return role === 'host' ? [...connections.keys()] : roomConnection?.peer ? [roomConnection.peer] : [];
  }

  async function beginVoice() {
    if (voiceHeld) return;
    if (!peer || !['host', 'client'].includes(role)) {
      micStatus.textContent = 'انضم إلى غرفة قبل استخدام الميكروفون.';
      return;
    }
    voiceHeld = true;
    try {
      if (!micStream) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('يتطلب الميكروفون صفحة آمنة مثل HTTPS أو localhost.');
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        for (const track of micStream.getAudioTracks()) track.enabled = false;
      }
      if (!voiceHeld) {
        for (const track of micStream.getAudioTracks()) track.enabled = false;
        return;
      }
      for (const track of micStream.getAudioTracks()) track.enabled = true;
      micButton.classList.add('is-live'); micButton.setAttribute('aria-pressed', 'true');
      micButton.title = 'الميكروفون مفتوح · اتركه للكتم';
      micStatus.textContent = 'الميكروفون مفتوح · اترك الزر لكتمه';
      for (const id of voicePeerIds()) {
        const existing = voiceCalls.get(id);
        if (existing?.voiceDirection === 'incoming') {
          voiceCalls.delete(id);
          existing.close();
        }
        if (!voiceCalls.has(id)) {
          const call = peer.call(id, micStream);
          if (call) {
            call.voiceDirection = 'outgoing';
            voiceCalls.set(id, call);
            call.on('stream', stream => attachRemoteVoice(stream, id));
            call.on('close', () => {
              if (voiceCalls.get(id) === call) {
                voiceCalls.delete(id);
                clearRemoteVoice(id);
              }
            });
          }
        }
      }
    } catch (error) {
      voiceHeld = false;
      micButton.classList.remove('is-live'); micButton.setAttribute('aria-pressed', 'false');
      micButton.title = 'اضغط مطولاً للتحدث';
      micStatus.textContent = error.name === 'NotAllowedError' ? 'لم تسمح بالميكروفون. فعّله من إعدادات المتصفح.' : error.message;
    }
  }

  function endVoice() {
    if (!voiceHeld) return;
    voiceHeld = false;
    for (const track of micStream?.getAudioTracks() || []) track.enabled = false;
    micButton.classList.remove('is-live'); micButton.setAttribute('aria-pressed', 'false');
    micButton.title = 'اضغط مطولاً للتحدث';
    micStatus.textContent = 'الميكروفون مكتوم · اضغط مطولاً للتحدث';
  }

  function receiveHostMessage(message) {
    if (message.type === 'start') startRace({ mode: 'online', name: playerName, length: message.length });
    if (message.type === 'players') {
      const active = {};
      for (const item of message.players || []) {
        if (item.id === peer.id) continue;
        active[item.id] = Object.assign(makePlayer(item.id, item.name, false, item.x, item.color || colors[1]), item);
      }
      rivals = active;
    }
    if (message.type === 'slowed' && message.target === peer.id && player) player.slowTime = Math.max(player.slowTime, Number(message.duration) || 3);
    if (message.type === 'eliminated' && rivals[message.id]) {
      rivals[message.id].eliminated = true;
      statusEl.textContent = `${message.name || rivals[message.id].name} خرج من السباق · أنت تشاهد`;
    }
    if (message.type === 'spectator') spectatorId = message.id || null;
    if (message.type === 'winner') finishGame(message.name, message.name === playerName);
  }

  function sendToAll(message) {
    if (role === 'host') {
      for (const connection of connections.values()) if (connection.open) connection.send(message);
    } else if (roomConnection?.open) roomConnection.send(message);
  }
  function broadcastPlayers() {
    if (role !== 'host' || !['playing', 'spectating'].includes(state)) return;
    const players = [player, ...Object.values(rivals)].map(item => ({ id: item.id, name: item.name, x: item.x, y: item.y, color: item.color, ability: item.ability, abilityTime: item.abilityTime, slowTime: item.slowTime, eliminated: Boolean(item.eliminated) }));
    sendToAll({ type: 'players', players });
  }
  function applyTag(target) {
    if (target === 'host' || target === player?.id) {
      if (player) player.slowTime = Math.max(player.slowTime, 3);
      if (role === 'host') sendToAll({ type: 'slowed', target: player.id, duration: 3 });
    } else {
      const rival = rivals[target];
      if (rival) {
        rival.slowTime = Math.max(rival.slowTime, 3);
        connections.get(target)?.send({ type: 'slowed', target, duration: 3 });
      }
    }
  }
  function declareWinner(name) {
    if (winner) return;
    if (role === 'client') {
      state = 'awaiting-result';
      statusEl.textContent = 'وصلت إلى النهاية · بانتظار تأكيد المضيف';
      sendToAll({ type: 'finish', name: playerName });
      return;
    }
    winner = name; sendToAll({ type: 'winner', name });
    finishGame(name, name === playerName);
  }
  function endRoundWithoutWinner() {
    if (winner) return;
    winner = 'تعادل'; sendToAll({ type: 'winner', name: winner });
    finishGame(winner, false);
  }
  function finishGame(name, didWin) {
    if (!['playing', 'spectating', 'awaiting-result'].includes(state)) return;
    state = 'finished';
    statusEl.textContent = didWin ? 'أنت الأول!' : `${name} وصل قبلك`;
    showRoundResult(name, didWin);
  }

  function eliminatePlayer(reason) {
    if (state !== 'playing') return;
    player.eliminated = true;
    spectatorId = null;
    state = 'spectating';
    statusEl.textContent = 'أُقصيت · تشاهد بقية السباق';
    if (mode === 'online') {
      sendToAll({ type: 'eliminated', id: player.id, name: player.name });
      if (role === 'host') {
        const active = [player, ...Object.values(rivals)].filter(item => !item.eliminated);
        if (!active.length) endRoundWithoutWinner();
      }
    }
    dialog.innerHTML = `<div class="sigil">◉</div><h2>خسرت هذه الجولة</h2><p>${escapeHtml(reason)}. بقيت متفرجاً حتى نهاية السباق.</p><p class="room-status">يمكنك متابعة المتسابقين أثناء محاولتهم الوصول.</p>`;
    overlay.hidden = false;
    window.setTimeout(() => { if (state === 'spectating') overlay.hidden = true; }, 1800);
  }

  function showRoundResult(name, didWin) {
    const online = mode === 'online';
    const tied = name === 'تعادل';
    const action = online
      ? (role === 'host' ? 'ابدأ جولة جديدة' : 'أنا جاهز للجولة التالية')
      : 'العب مجدداً';
    dialog.innerHTML = `<div class="sigil">${didWin ? '✦' : '◎'}</div><h2>${tied ? 'انتهت الجولة بالتعادل' : didWin ? 'فزت وحدك!' : `${escapeHtml(name)} فاز`}</h2><p>${didWin ? 'وصلت إلى النهاية أولاً.' : 'شاهدت بقية السباق حتى انتهى.'}</p><button class="primary" id="round-action" type="button">${action}</button>${online ? '<p class="hint">الغرفة باقية. لن تحتاج إلى رمز جديد.</p><button class="menu-action" id="leave-room" type="button">مغادرة الغرفة</button>' : ''}`;
    document.querySelector('#round-action').addEventListener('click', () => {
      if (online && role !== 'host') {
        sendToAll({ type: 'ready', name: playerName });
        document.querySelector('#round-action').disabled = true;
        document.querySelector('#round-action').textContent = 'بانتظار المضيف…';
        return;
      }
      if (online) startRace({ mode: 'online', name: playerName, length: selectedLength });
      else startRace({ mode: 'solo', name: playerName, length: selectedLength });
    });
    document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
    overlay.hidden = false;
  }

  function leaveRoom() {
    connections.clear(); roomConnection?.close(); roomConnection = null;
    for (const call of voiceCalls.values()) call.close();
    voiceCalls.clear();
    for (const remoteAudio of document.querySelectorAll('audio[data-voice]')) remoteAudio.remove();
    micStream?.getTracks().forEach(track => track.stop());
    micStream = null;
    endVoice();
    if (peer && !peer.destroyed) peer.destroy();
    peer = null; mode = 'solo'; role = 'solo'; state = 'menu'; winner = null;
    statusEl.hidden = true; progressBar.hidden = true; drawMenu(); bindMenu(); overlay.hidden = false;
  }

  function showMessage(title, copy, buttonText, callback) {
    dialog.innerHTML = `<div class="sigil" aria-hidden="true">✦</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p><button class="primary" id="return-menu" type="button">${escapeHtml(buttonText)}</button>`;
    document.querySelector('#return-menu').addEventListener('click', () => {
      state = 'menu'; overlay.hidden = false; statusEl.hidden = true; progressBar.hidden = true;
      connections.clear(); roomConnection?.close(); roomConnection = null;
      if (peer && !peer.destroyed) peer.destroy();
      peer = null; mode = 'solo'; role = 'solo';
      callback(); bindMenu();
    });
    overlay.hidden = false;
  }
  function escapeHtml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

  function choosePower() {
    if (state !== 'playing') return;
    state = 'choose';
    dialog.innerHTML = `<div class="sigil">✦</div><h2>اختر قدرتك</h2><p>قدرة واحدة في كل صندوق. فكّر بنفسك، لا بفريقك.</p><div class="ability-options">${Object.entries(labels).map(([key, label]) => `<button class="ability-btn" data-ability="${key}"><strong>${label}</strong><span>${descriptions[key]}</span></button>`).join('')}</div>`;
    dialog.querySelectorAll('[data-ability]').forEach(button => button.addEventListener('click', () => activatePower(button.dataset.ability)));
    overlay.hidden = false;
  }
  function activatePower(type) {
    player.ability = type;
    player.abilityTime = type === 'fly' ? 5 : type === 'dash' ? 4 : 9;
    for (const box of boxes) if (Math.abs(box.x - player.x) < 60) box.collected = true;
    state = 'playing'; overlay.hidden = true;
    statusEl.textContent = `قدرتك: ${labels[type]}`;
  }

  function update(dt) {
    if (state === 'spectating' || state === 'awaiting-result') {
      elapsed += dt;
      if (mode === 'solo') {
        updateBots(dt);
        const finisher = bots.find(bot => !bot.eliminated && bot.x >= worldWidth - 72);
        if (finisher) { declareWinner(finisher.name); return; }
        if (bots.every(bot => bot.eliminated)) { endRoundWithoutWinner(); return; }
      } else if (role === 'host') {
        const active = Object.values(rivals).filter(item => !item.eliminated);
        const finisher = active.find(item => item.x >= worldWidth - 72);
        if (finisher) { declareWinner(finisher.name); return; }
        if (!active.length) { endRoundWithoutWinner(); return; }
      }
      followSpectator(dt);
      return;
    }
    if (state !== 'playing') return;
    elapsed += dt;
    const prevY = player.y;
    const slowed = player.slowTime > 0;
    const boost = player.ability === 'dash' && player.abilityTime > 0 ? 1.65 : 1;
    const baseSpeed = (slowed ? 145 : 245) * boost;
    const targetVx = keys.left === keys.right ? 0 : keys.left ? -baseSpeed : baseSpeed;
    player.vx += (targetVx - player.vx) * Math.min(1, dt * 12);
    if (keys.jump && player.grounded) { player.vy = -560; player.grounded = false; }
    const flying = player.ability === 'fly' && player.abilityTime > 0;
    player.vy = Math.min(740, player.vy + (flying ? 150 : 1370) * dt);
    player.x = Math.max(0, Math.min(worldWidth - player.w, player.x + player.vx * dt));
    player.y += player.vy * dt; player.grounded = false; player.flying = flying;
    const center = player.x + player.w / 2;
    const inPit = pits.some(([left, right]) => center > left && center < right);
    if ((!inPit || flying) && prevY + player.h <= floorY && player.y + player.h >= floorY) {
      player.y = floorY - player.h; player.vy = 0; player.grounded = true;
    }
    for (const [left, right, top] of platforms) {
      if (player.vy >= 0 && prevY + player.h <= top && player.y + player.h >= top && player.x + player.w > left && player.x < right) {
        player.y = top - player.h; player.vy = 0; player.grounded = true;
      }
    }
    player.slowTime = Math.max(0, player.slowTime - dt);
    player.abilityTime = Math.max(0, player.abilityTime - dt);
    if (player.abilityTime === 0) player.ability = null;
    if (player.y > H + 80 || (player.x < hazardX() + 38 && player.y + player.h > floorY - 120)) {
      eliminatePlayer(player.y > H + 80 ? 'سقطت في الفراغ' : 'ابتلعك الضباب');
      if (mode === 'solo') updateBots(dt);
      followSpectator(dt);
      return;
    }
    for (const box of boxes) {
      if (!box.collected && Math.abs(player.x - box.x) < 31 && Math.abs(player.y + player.h / 2 - box.y) < 35) {
        choosePower(); break;
      }
    }
    const otherPlayers = mode === 'solo' ? bots : Object.values(rivals);
    if (player.ability === 'slow' && player.abilityTime > 0) {
      const now = performance.now();
      for (const rival of otherPlayers) {
        if (Math.abs(player.x - rival.x) < 26 && Math.abs(player.y - rival.y) < 45 && now - player.lastTag > 1100) {
          player.lastTag = now;
          if (mode === 'online') {
            const target = rival.id === 'host' ? 'host' : rival.id;
            if (role === 'host') applyTag(target); else sendToAll({ type: 'tag', target });
          } else rival.slowTime = 3;
        }
      }
    }
    for (const rival of otherPlayers) if (rival.slowTime > 0) rival.slowTime = Math.max(0, rival.slowTime - dt);
    updateBots(dt);
    if (player.x >= worldWidth - 72) { declareWinner(playerName); return; }
    for (const bot of bots) if (!bot.eliminated && bot.x >= worldWidth - 72) { declareWinner(bot.name); return; }
    for (const rival of Object.values(rivals)) if (rival.x >= worldWidth - 72) { declareWinner(rival.name); return; }
    cameraX += ((player.x - W * .34) - cameraX) * Math.min(1, dt * 5);
    cameraX = Math.max(0, Math.min(worldWidth - W, cameraX));
    updateHud();
  }

  function updateBots(dt) {
    for (const bot of bots) {
      if (bot.eliminated) continue;
      const speed = bot.slowTime > 0 ? 125 : bot.id === 'bot-a' ? 195 : 213;
      bot.x += speed * dt;
      if (Math.floor((bot.x + 80) / 450) !== Math.floor((bot.x + speed * dt + 80) / 450) && Math.random() > .35) bot.vy = -500;
      bot.vy = Math.min(700, bot.vy + 1350 * dt); bot.y += bot.vy * dt;
      const botPit = pits.some(([left, right]) => bot.x + bot.w / 2 > left && bot.x + bot.w / 2 < right);
      if (!botPit && bot.y + bot.h >= floorY) { bot.y = floorY - bot.h; bot.vy = 0; }
      for (const [left, right, top] of platforms) if (bot.vy >= 0 && bot.y + bot.h >= top && bot.y + bot.h - bot.vy * dt <= top && bot.x + bot.w > left && bot.x < right) { bot.y = top - bot.h; bot.vy = 0; }
      if (bot.y > H + 80) bot.eliminated = true;
    }
  }
  function followSpectator(dt) {
    const active = [...bots, ...Object.values(rivals)].filter(item => !item.eliminated);
    const target = active.sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
    if (!target) return;
    spectatorId = target.id;
    cameraX += ((target.x - W * .34) - cameraX) * Math.min(1, dt * 4);
    cameraX = Math.max(0, Math.min(worldWidth - W, cameraX));
  }
  function hazardX() { return Math.max(-1000, elapsed * 280 - 1000); }
  function updateHud() {
    const all = [player, ...bots, ...Object.values(rivals)].sort((a, b) => b.x - a.x);
    const rank = all.findIndex(item => item.isLocal || item.id === player.id) + 1;
    scoreEl.textContent = number(rank);
    distanceEl.textContent = `${number(Math.max(0, Math.min(100, Math.floor(player.x / worldWidth * 100)) ))}٪`;
    progressFill.style.width = `${Math.max(0, Math.min(100, player.x / worldWidth * 100))}%`;
  }

  function draw(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#132943'); sky.addColorStop(.58, '#28656a'); sky.addColorStop(1, '#9bbb80');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff0c8'; ctx.fillRect(745 - cameraX * .06, 75, 42, 42);
    for (let i = 0; i < 36; i++) {
      const x = ((i * 173 + 31 - cameraX * .15) % W + W) % W, y = (i * 79 + 27) % 265;
      ctx.fillStyle = i % 3 ? '#b8d8e0' : '#ffe1a0'; ctx.fillRect(x, y, 2, 2);
    }
    drawHills(time, .13, 335, '#244d55', 60); drawHills(time, .25, 385, '#173e46', 38);
    ctx.save(); ctx.translate(-cameraX, 0);
    for (let x = 0; x < worldWidth; x += 38) {
      if (pits.some(([left, right]) => x + 30 > left && x < right)) continue;
      ctx.fillStyle = '#604334'; ctx.fillRect(x, floorY, 39, H - floorY);
      ctx.fillStyle = '#75b574'; ctx.fillRect(x, floorY, 39, 10);
      ctx.fillStyle = '#3a6449'; ctx.fillRect(x, floorY + 10, 39, 5);
      if (x % 76 === 0) { ctx.fillStyle = '#bdd383'; ctx.fillRect(x + 13, floorY - 9, 3, 9); }
    }
    for (const [left, right] of pits) { ctx.fillStyle = '#112a3a'; ctx.fillRect(left, floorY, right - left, H - floorY); ctx.fillStyle = '#476c62'; ctx.fillRect(left, floorY, right - left, 6); }
    for (const [left, right, top] of platforms) {
      ctx.fillStyle = '#be8653'; ctx.fillRect(left, top, right - left, 12); ctx.fillStyle = '#785238'; ctx.fillRect(left, top + 12, right - left, 9); ctx.fillStyle = '#e3aa67'; ctx.fillRect(left, top + 9, right - left, 3);
    }
    for (const box of boxes) if (!box.collected) {
      const y = box.y + Math.sin(time * .004 + box.bob) * 5;
      ctx.fillStyle = '#f0d879'; ctx.fillRect(box.x - 15, y - 16, 30, 30); ctx.fillStyle = '#8e633d'; ctx.fillRect(box.x - 12, y - 13, 24, 24); ctx.fillStyle = '#ffe690'; ctx.fillRect(box.x - 5, y - 9, 10, 16); ctx.fillStyle = '#fff8c8'; ctx.fillRect(box.x - 2, y - 6, 4, 10);
    }
    drawFinishLine();
    for (const rival of [...bots, ...Object.values(rivals)]) drawRacer(rival, time);
    if (player) drawRacer(player, time);
    drawHazard();
    ctx.restore();
    if (state === 'playing' || state === 'choose') {
      ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.font = 'bold 15px Changa, Tahoma, sans-serif'; ctx.fillStyle = '#fff1cc';
      const powerText = player.ability ? `${labels[player.ability]} · ${number(Math.ceil(player.abilityTime))}` : 'ابحث عن صندوق القدرة';
      ctx.fillText(powerText, W - 17, 63);
      ctx.textAlign = 'left'; ctx.fillStyle = '#f6eabd'; ctx.fillText(`النهاية · ${number(mapLength)} م`, 18, 63);
    }
    if (state === 'countdown') {
      const count = Math.max(1, Math.ceil((countdownUntil - time) / 600));
      ctx.fillStyle = '#071b23aa'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.font = 'bold 52px Changa, Tahoma, sans-serif'; ctx.fillStyle = '#ffe29b';
      ctx.fillText(number(count), W / 2, H / 2 + 15);
    }
    if (state === 'spectating') {
      ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.font = 'bold 16px Changa, Tahoma, sans-serif'; ctx.fillStyle = '#f9edc8';
      const watched = [...bots, ...Object.values(rivals)].find(item => item.id === spectatorId);
      ctx.fillText(watched ? `تشاهد الآن: ${watched.name}` : 'وضع المشاهدة · السباق مستمر', W / 2, H - 24);
    }
  }

  function drawHills(time, factor, base, color, amplitude) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) {
      const wx = x + cameraX * factor;
      ctx.lineTo(x, base + Math.sin(wx * .007 + time * .00018) * amplitude + Math.sin(wx * .018) * 10);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  function drawRacer(racer, time) {
    if (racer.eliminated && Math.floor(time / 280) % 2) return;
    if (racer.slowTime > 0 && Math.floor(time / 100) % 2) return;
    const x = Math.round(racer.x), y = Math.round(racer.y);
    ctx.globalAlpha = racer.eliminated ? .42 : 1;
    ctx.fillStyle = racer.color || colors[1]; ctx.fillRect(x + 3, y + 6, 20, 24);
    ctx.fillStyle = '#f0c69a'; ctx.fillRect(x + 4, y, 17, 15);
    ctx.fillStyle = '#282a38'; ctx.fillRect(x + 3, y - 2, 19, 5); ctx.fillRect(x + 16, y + 6, 3, 4);
    ctx.fillStyle = '#263541'; ctx.fillRect(x + 5, y + 29, 6, 9); ctx.fillRect(x + 16, y + 29, 6, 9);
    if (racer.ability === 'fly' && racer.abilityTime > 0) {
      ctx.fillStyle = '#ffe796'; ctx.beginPath(); ctx.moveTo(x + 3, y + 16); ctx.lineTo(x - 11, y + 8); ctx.lineTo(x - 7, y + 23); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 22, y + 16); ctx.lineTo(x + 36, y + 8); ctx.lineTo(x + 32, y + 23); ctx.closePath(); ctx.fill();
    }
    ctx.font = '11px Changa, Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillStyle = '#fff';
    ctx.fillText(racer.name || 'متسابق', x + 12, y - 8);
    if (racer.eliminated) { ctx.fillStyle = '#f4c8b7'; ctx.fillText('مُقصى', x + 12, y - 19); }
    if (racer.slowTime > 0) { ctx.fillStyle = '#b6a1ed'; ctx.fillText('✦', x + 12, y - 18); }
    ctx.globalAlpha = 1;
  }
  function drawFinishLine() {
    const x = worldWidth - 74;
    ctx.fillStyle = '#e8dfa5'; ctx.fillRect(x, floorY - 125, 6, 125);
    ctx.fillStyle = '#ef8b60'; ctx.fillRect(x + 6, floorY - 125, 50, 23);
    ctx.fillStyle = '#f5e5b0'; ctx.fillRect(x + 6, floorY - 102, 50, 23);
    ctx.fillStyle = '#ef8b60'; ctx.fillRect(x + 6, floorY - 79, 50, 23);
  }
  function drawHazard() {
    const x = hazardX();
    const gradient = ctx.createLinearGradient(x - 70, 0, x + 48, 0);
    gradient.addColorStop(0, '#854f9c00'); gradient.addColorStop(.7, '#874fa9b8'); gradient.addColorStop(1, '#312042');
    ctx.fillStyle = gradient; ctx.fillRect(x - 70, 0, 120, H);
    ctx.fillStyle = '#b17bc5';
    for (let y = 0; y < H; y += 34) { const wobble = Math.sin(y * .07 + performance.now() * .003) * 8; ctx.fillRect(x + wobble, y, 8, 19); }
  }

  function frame(time) {
    const dt = Math.min(.032, (time - (lastTime || time)) / 1000); lastTime = time;
    if (state === 'countdown' && time >= countdownUntil) {
      state = 'playing';
      statusEl.textContent = mode === 'solo' ? 'سباق فردي · الضباب يطاردك' : 'سباق أونلاين · لا ترحم أحداً';
    }
    update(dt);
    if (mode === 'online' && ['playing', 'spectating', 'awaiting-result'].includes(state) && time - lastNetworkSend > 55) {
      const packet = { type: 'state', x: player.x, y: player.y, ability: player.ability, abilityTime: player.abilityTime, slowTime: player.slowTime };
      if (role === 'host') broadcastPlayers();
      else if (state === 'playing') sendToAll(packet);
      lastNetworkSend = time;
    }
    draw(time); requestAnimationFrame(frame);
  }

  function bindMenu() {
    document.querySelector('#solo-game')?.addEventListener('click', startSolo);
    document.querySelector('#create-room')?.addEventListener('click', createRoom);
    document.querySelector('#join-room')?.addEventListener('click', joinRoom);
    document.querySelector('#start-online')?.addEventListener('click', startOnlineRace);
    document.querySelector('#copy-code')?.addEventListener('click', copyRoomCode);
  }
  function startOnlineRace() {
    if (mode !== 'host' || connections.size < 1) { setStatus('انتظر انضمام صديق واحد على الأقل.'); return; }
    playerName = document.querySelector('#player-name').value.trim() || playerName;
    startRace({ mode: 'online', name: playerName, length: document.querySelector('#map-length').value });
  }
  async function copyRoomCode() {
    const code = document.querySelector('#host-code').value;
    try { await navigator.clipboard.writeText(code); setStatus('نُسخ الرمز. أرسله لصديقك.'); }
    catch (_) { document.querySelector('#host-code').select(); setStatus('حدّد الرمز وانسخه لمشاركته.'); }
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused'; pauseButton.textContent = '▶';
      dialog.innerHTML = '<div class="sigil">✦</div><h2>استراحة قصيرة</h2><p>اضغط متابعة عندما تكون جاهزاً.</p><button class="primary" id="resume-race" type="button">تابع السباق</button>';
      document.querySelector('#resume-race').addEventListener('click', () => { state = 'playing'; overlay.hidden = true; pauseButton.textContent = 'Ⅱ'; });
      overlay.hidden = false;
    } else if (state === 'paused') { state = 'playing'; overlay.hidden = true; pauseButton.textContent = 'Ⅱ'; }
  }
  function handleKey(event, down) {
    const key = event.key.toLowerCase();
    if (event.target === micButton && [' ', 'enter'].includes(key)) return;
    if (['arrowleft', 'arrowright', 'arrowup', ' ', 'a', 'd', 'w', 'e'].includes(key)) event.preventDefault();
    if (key === 'arrowleft' || key === 'a') keys.left = down;
    if (key === 'arrowright' || key === 'd') keys.right = down;
    if (key === 'arrowup' || key === 'w' || key === ' ') keys.jump = down;
    if (key === 'escape' && down) togglePause();
  }

  document.addEventListener('keydown', event => handleKey(event, true));
  document.addEventListener('keyup', event => handleKey(event, false));
  window.addEventListener('blur', () => { keys.left = false; keys.right = false; keys.jump = false; });
  document.querySelectorAll('.touch-btn').forEach(button => {
    const key = button.dataset.key;
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
      keys[key] = true;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => { keys[key] = false; });
  });
  pauseButton.addEventListener('click', togglePause);
  micButton.addEventListener('pointerdown', event => {
    event.preventDefault();
    try { micButton.setPointerCapture(event.pointerId); } catch (_) {}
    beginVoice();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) micButton.addEventListener(type, endVoice);
  micButton.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); beginVoice(); }
  });
  micButton.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); endVoice(); }
  });
  micButton.addEventListener('blur', endVoice);
  window.addEventListener('blur', endVoice);
  drawMenu(); setHeader(); bindMenu(); requestAnimationFrame(frame);
})();
