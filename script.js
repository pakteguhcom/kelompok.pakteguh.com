// Pembagi Kelompok Acak — musik otomatis berhenti saat selesai + UI modern/responsif
(function(){
  // Elements
  const namesInput = document.getElementById('namesInput');
  const fileInput = document.getElementById('fileInput');
  const fileDrop = document.getElementById('fileDrop');

  const modeCount = document.getElementById('modeCount');
  const modeSize = document.getElementById('modeSize');
  const groupCountInput = document.getElementById('groupCount');
  const groupSizeInput = document.getElementById('groupSize');

  const revealSpeed = document.getElementById('revealSpeed');
  const dramaticMode = document.getElementById('dramaticMode');
  const bgmEnabled = document.getElementById('bgmEnabled');
  const volume = document.getElementById('volume');
  const musicStyleSel = document.getElementById('musicStyle');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnReset = document.getElementById('btnReset');
  const btnReshuffle = document.getElementById('btnReshuffle');
  const btnSeedSample = document.getElementById('btnSeedSample');
  const btnClear = document.getElementById('btnClear');
  const btnExport = document.getElementById('btnExport');

  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progressEl');
  const progressBar = document.getElementById('progressBar');
  const groupsContainer = document.getElementById('groupsContainer');
  const lights = document.getElementById('lights');

  // State
  const state = {
    names: [],
    groups: [],
    revealQueue: [],
    revealed: 0,
    timer: null,
    paused: false,
    started: false,
    settings: {
      mode: 'count',
      count: 3,
      size: 3,
      dramatic: true,
      speed: 3, // 1..5
      bgm: true,
      volume: 0.45,
      musicStyle: 'cinematic', // cinematic | suspense | ambient | lofi
    }
  };

  // AUDIO ENGINE (musikal)
  const audio = {
    ctx: null,
    master: null,
    masterGain: null,
    musicGain: null,   // for ducking & fadeout
    delayNode: null,
    delayFeedback: null,
    playing: false,
    baseMusicLevel: 0.9,
    // layers
    pad: [],
    arp: { osc:null, gain:null, seqIdx:0, nextTime:0, chord:null },
    drums: { nextTime:0, step:0, bus:null, noiseBuf:null },
    // scheduler
    bpm: 100,
    lookahead: 25/1000,
    scheduleAhead: 0.12,
    schedulerId: null,
    // sfx
    tickGain: null,
  };

  // Utils
  function clamp(v, mn, mx){ return Math.max(mn, Math.min(mx, v)); }
  function clampInt(v, mn, mx){ return clamp(parseInt(v,10) || 0, mn, mx); }

  function parseNames(raw){
    if(!raw) return [];
    const parts = raw.split(/\r?\n|,/g).map(s=>s.trim()).filter(Boolean);
    const seen = new Set(), out=[];
    for(const p of parts){ if(!seen.has(p)){ seen.add(p); out.push(p); } }
    return out;
  }

  function updateSettingsFromUI(){
    state.settings.mode = modeCount.checked ? 'count' : 'size';
    state.settings.count = clampInt(groupCountInput.value, 1, 999) || 1;
    state.settings.size = clampInt(groupSizeInput.value, 1, 999) || 1;
    state.settings.dramatic = dramaticMode.checked;
    state.settings.speed = clampInt(revealSpeed.value, 1, 5);
    state.settings.bgm = bgmEnabled.checked;
    state.settings.volume = clamp(parseInt(volume.value,10)/100, 0, 1);
    state.settings.musicStyle = musicStyleSel.value;

    groupSizeInput.disabled = (state.settings.mode === 'count');
    groupCountInput.disabled = (state.settings.mode === 'size');

    // Map speed -> bpm
    const bpmMap = [70, 85, 100, 112, 126];
    audio.bpm = bpmMap[state.settings.speed-1];
    if(audio.master){ audio.master.gain.value = state.settings.volume; }
  }

  // FIX: swap yang benar (bug sebelumnya membuat array berisi undefined)
  function shuffleInPlace(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildGroups(names){
    let groups = [];
    const copy = names.slice(); shuffleInPlace(copy);
    if(state.settings.mode === 'count'){
      const k = Math.max(1, state.settings.count);
      groups = Array.from({length:k}, ()=>[]);
      for(let i=0;i<copy.length;i++){ groups[i%k].push(copy[i]); }
    }else{
      const size = Math.max(1, state.settings.size);
      for(let i=0;i<copy.length;i+=size){ groups.push(copy.slice(i,i+size)); }
    }
    return groups;
  }

  function renderGroupsShell(groups){
    groupsContainer.innerHTML = '';
    groups.forEach((_, idx)=>{
      const card = document.createElement('div');
      card.className = 'group-card';
      const title = document.createElement('h3');
      title.className = 'group-title';
      title.textContent = `👥 Kelompok ${idx+1}`;
      const list = document.createElement('ul');
      list.className = 'name-list';
      list.id = `groupList-${idx}`;
      card.appendChild(title);
      card.appendChild(list);
      groupsContainer.appendChild(card);
    });
  }

  function queueReveal(groups){
    const items = [];
    const k = groups.length;
    const maxLen = Math.max(...groups.map(g=> (g ? g.length : 0) ), 0);
    for(let r=0;r<maxLen;r++){
      const order = Array.from({length:k}, (_,i)=>i);
      shuffleInPlace(order);
      for(const gi of order){
        const group = groups[gi];
        if(!group) continue; // guard tambahan
        const name = group[r];
        if(name !== undefined){ items.push({name, gi}); }
      }
    }
    state.revealQueue = items;
    state.revealed = 0;
    updateProgress();
  }

  function revealNext(){
    if(state.revealed >= state.revealQueue.length){
      stopTimer();
      // Pastikan progress 100%
      progressBar.style.width = '100%';
      if(progressEl){ progressEl.setAttribute('aria-valuenow', '100'); }

      setStatus('Selesai! 🎉');
      setButtonsState({ running:false, done:true });

      // SFX penutup dan auto stop musik
      audioStinger();
      stopBgm(true);            // otomatis berhenti saat selesai
      lights.classList.remove('on'); // matikan efek lampu
      return;
    }
    const item = state.revealQueue[state.revealed++];
    const ul = document.getElementById(`groupList-${item.gi}`);
    if(ul){
      const li = document.createElement('li');
      li.className = 'name-item';
      li.textContent = item.name;
      ul.appendChild(li);
    }

    audioTick(); // klik + ducking
    if(state.settings.dramatic && Math.random() < 0.25){ pulseLights(); }

    updateProgress();
    scheduleNextTick();
  }

  function updateProgress(){
    const total = state.revealQueue.length || 1;
    const pct = Math.round((state.revealed/total)*100);
    progressBar.style.width = `${pct}%`;
    if(progressEl){ progressEl.setAttribute('aria-valuenow', String(pct)); }
    setStatus(`Mengungkap: ${state.revealed} / ${total}`);
  }

  function setStatus(text){ statusEl.textContent = text; }

  function setButtonsState({running, done}){
    btnStart.disabled = running || done;
    btnPause.disabled = !running;
    btnReset.disabled = !running && !done && !state.started;
    btnReshuffle.disabled = running || !done;
    btnExport.disabled = !done;
  }

  function scheduleNextTick(){
    const speed = state.settings.speed;
    const base = [1200, 900, 650, 450, 300][speed-1];
    const variance = base * 0.25;
    let delay = base + (Math.random()*variance - variance/2);
    const remaining = state.revealQueue.length - state.revealed;
    if(remaining <= 3){ delay *= 1.35; }
    state.timer = setTimeout(()=>{ if(!state.paused) revealNext(); }, delay);
  }

  function stopTimer(){ if(state.timer){ clearTimeout(state.timer); state.timer = null; } }

  function startReveal(){
    if(state.revealQueue.length === 0){ setStatus('Tidak ada yang diungkap.'); return; }
    state.started = true;
    state.paused = false;
    setButtonsState({running:true, done:false});
    if(state.settings.dramatic){ lights.classList.add('on'); }
    if(state.settings.bgm){ ensureAudio().then(()=> startBgm()); }
    scheduleNextTick();
  }

  function pauseReveal(){
    state.paused = true;
    stopTimer();
    setStatus('Dijeda.');
    btnPause.textContent = '▶️ Lanjut';
    stopBgm(true);
  }

  function resumeReveal(){
    state.paused = false;
    setStatus('Berjalan...');
    btnPause.textContent = '⏸️ Jeda';
    if(state.settings.bgm){ startBgm(); }
    scheduleNextTick();
  }

  function resetAll(){
    stopTimer();
    state.started = false;
    state.paused = false;
    state.revealed = 0;
    state.revealQueue = [];
    state.groups = [];
    progressBar.style.width = '0%';
    if(progressEl){ progressEl.setAttribute('aria-valuenow', '0'); }
    setStatus('Siap.');
    groupsContainer.innerHTML = '';
    setButtonsState({running:false, done:false});
    lights.classList.remove('on');
    stopBgm(false);
  }

  function reshuffle(){
    if(state.names.length < 2){ setStatus('Masukkan minimal 2 nama.'); return; }
    state.groups = buildGroups(state.names);
    renderGroupsShell(state.groups);
    queueReveal(state.groups);
    setStatus('Siap mengungkap (acak ulang).');
    progressBar.style.width = '0%';
    if(progressEl){ progressEl.setAttribute('aria-valuenow', '0'); }
    setButtonsState({running:false, done:false});
  }

  function seedSample(){
    const sample = ['Andi','Budi','Citra','Dina','Eko','Fajar','Gita','Heri','Intan','Joko','Kiki','Lani','Mira','Nando','Oki','Putri','Qori','Raka','Sari','Tono','Uli','Vina','Wira','Xena','Yudi','Zara'];
    namesInput.value = sample.join('\n');
    saveToLocal();
  }

  function exportCSV(){
    if(!state.groups?.length) return;
    const rows = [];
    const maxLen = Math.max(...state.groups.map(g=>g.length));
    const header = state.groups.map((_,i)=>`Kelompok ${i+1}`);
    rows.push(header);
    for(let r=0;r<maxLen;r++){ rows.push(state.groups.map(g => (g[r]??''))); }
    const csv = rows.map(r=>r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'hasil-kelompok.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // File handling
  function handleFiles(files){
    if(!files || files.length===0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseNames(text);
      if(parsed.length === 0){ setStatus('File kosong atau tidak berisi nama yang valid.'); return; }
      namesInput.value = parsed.join('\n');
      saveToLocal();
      setStatus(`Berhasil memuat ${parsed.length} nama dari file.`);
    };
    reader.onerror = () => setStatus('Gagal membaca file.');
    reader.readAsText(file, 'utf-8');
  }

  fileDrop.addEventListener('click', ()=> fileInput.click());
  fileDrop.addEventListener('dragover', (e)=>{ e.preventDefault(); fileDrop.style.borderColor = '#6ea8fe'; });
  fileDrop.addEventListener('dragleave', ()=>{ fileDrop.style.borderColor = '#28406e'; });
  fileDrop.addEventListener('drop', (e)=>{
    e.preventDefault();
    fileDrop.style.borderColor = '#28406e';
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', (e)=> handleFiles(e.target.files));

  // Local storage
  function saveToLocal(){
    try{
      const payload = { names: namesInput.value, settings: state.settings };
      localStorage.setItem('group-dramatic-settings', JSON.stringify(payload));
    }catch{}
  }
  function loadFromLocal(){
    try{
      const raw = localStorage.getItem('group-dramatic-settings'); if(!raw) return;
      const payload = JSON.parse(raw);
      if(payload?.names){ namesInput.value = String(payload.names); }
      if(payload?.settings){
        const s = payload.settings;
        if(s.mode === 'size'){ modeSize.checked = true; } else { modeCount.checked = true; }
        groupCountInput.value = s.count ?? 3;
        groupSizeInput.value = s.size ?? 3;
        revealSpeed.value = s.speed ?? 3;
        dramaticMode.checked = !!s.dramatic;
        bgmEnabled.checked = !!s.bgm;
        volume.value = Math.round((s.volume ?? 0.45)*100);
        if(s.musicStyle){ musicStyleSel.value = s.musicStyle; }
      }
      updateSettingsFromUI();
    }catch{}
  }

  // Wiring UI
  [modeCount, modeSize, groupCountInput, groupSizeInput, revealSpeed, dramaticMode, bgmEnabled, volume, musicStyleSel]
    .forEach(el => el.addEventListener('input', ()=>{
      updateSettingsFromUI();
      saveToLocal();
      if(state.started && state.settings.bgm){ applyMusicStyle(); }
    }));

  namesInput.addEventListener('input', saveToLocal);

  btnSeedSample.addEventListener('click', (e)=>{ e.preventDefault(); seedSample(); });
  btnClear.addEventListener('click', (e)=>{ e.preventDefault(); namesInput.value=''; saveToLocal(); });

  btnStart.addEventListener('click', (e)=>{
    e.preventDefault();
    updateSettingsFromUI();

    const names = parseNames(namesInput.value);
    if(names.length < 2){ setStatus('Masukkan minimal 2 nama.'); return; }

    if(state.settings.mode === 'count'){
      if(state.settings.count > names.length){
        setStatus(`Catatan: Jumlah kelompok (${state.settings.count}) > jumlah nama (${names.length}). Beberapa kelompok akan kosong.`);
      }
    }

    state.names = names;
    state.groups = buildGroups(names);
    renderGroupsShell(state.groups);
    queueReveal(state.groups);

    setStatus('Mulai...');
    btnPause.textContent = '⏸️ Jeda';
    startReveal();
  });

  btnPause.addEventListener('click', (e)=>{
    e.preventDefault();
    if(state.paused){ resumeReveal(); } else { pauseReveal(); }
  });

  btnReset.addEventListener('click', (e)=>{ e.preventDefault(); resetAll(); });
  btnReshuffle.addEventListener('click', (e)=>{ e.preventDefault(); reshuffle(); });
  btnExport.addEventListener('click', (e)=>{ e.preventDefault(); exportCSV(); });

  // Audio helpers
  function midiToFreq(m){ return 440 * Math.pow(2, (m-69)/12); }

  async function ensureAudio(){
    if(audio.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.ctx = ctx;

    // Master
    const master = ctx.createGain(); master.gain.value = state.settings.volume; master.connect(ctx.destination);
    audio.master = master; audio.masterGain = master;

    // Music bus (ducking/fade)
    const musicGain = ctx.createGain(); musicGain.gain.value = audio.baseMusicLevel; musicGain.connect(master);
    audio.musicGain = musicGain;

    // Delay bus
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    delay.connect(musicGain);
    audio.delayNode = delay; audio.delayFeedback = fb;

    // PAD
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 1200; padFilter.Q.value = 0.5;
    padFilter.connect(musicGain);
    const padGain = ctx.createGain(); padGain.gain.value = 0.22; padGain.connect(padFilter);
    const pad1 = ctx.createOscillator(); pad1.type = 'sawtooth';
    const pad2 = ctx.createOscillator(); pad2.type = 'sawtooth'; pad2.detune.value = +6;
    pad1.connect(padGain); pad2.connect(padGain);
    pad1.start(); pad2.start();
    audio.pad = [{osc:pad1, gain:padGain, filter:padFilter}, {osc:pad2, gain:padGain, filter:padFilter}];

    // Send some pad to delay
    const padSend = ctx.createGain(); padSend.gain.value = 0.2; padGain.connect(padSend).connect(delay);

    // ARP
    const arpGain = ctx.createGain(); arpGain.gain.value = 0.0;
    const arpOsc = ctx.createOscillator(); arpOsc.type = 'triangle';
    arpOsc.connect(arpGain);
    const arpSend = ctx.createGain(); arpSend.gain.value = 0.5; arpGain.connect(arpSend).connect(delay);
    arpGain.connect(musicGain);
    arpOsc.start();
    audio.arp = { osc: arpOsc, gain: arpGain, seqIdx: 0, nextTime: 0, chord: null };

    // DRUMS
    const drumBus = ctx.createGain(); drumBus.gain.value = 0.22; drumBus.connect(musicGain);
    audio.drums.bus = drumBus;

    // delay tap for drums
    const drumSend = ctx.createGain(); drumSend.gain.value = 0.12; drumBus.connect(drumSend).connect(delay);

    // noise buffer
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0); for(let i=0;i<data.length;i++){ data[i]=Math.random()*2-1; }
    audio.drums.noiseBuf = noiseBuf;

    // Tick SFX
    const tickGain = ctx.createGain(); tickGain.gain.value = 0.0; tickGain.connect(master);
    audio.tickGain = tickGain;

    applyMusicStyle();
  }

  function startBgm(){
    if(!audio.ctx || audio.playing) return;
    audio.playing = true;
    audio.ctx.resume?.();

    // Fade in music bus
    const g = audio.musicGain.gain, now = audio.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(audio.baseMusicLevel, now + 1.0);

    // Reset schedulers
    audio.arp.nextTime = now + 0.05;
    audio.drums.nextTime = now + 0.05;
    audio.drums.step = 0;

    // Start scheduler loop
    if(audio.schedulerId) clearInterval(audio.schedulerId);
    audio.schedulerId = setInterval(schedulerTick, audio.lookahead*1000);
  }

  function stopBgm(fade=true){
    if(!audio.ctx || !audio.playing) return;
    audio.playing = false;
    if(audio.schedulerId){ clearInterval(audio.schedulerId); audio.schedulerId = null; }
    const g = audio.musicGain.gain, now = audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0, now + (fade?0.7:0.0));
  }

  function schedulerTick(){
    const ctx = audio.ctx;
    const secondsPerBeat = 60.0 / audio.bpm;
    let now = ctx.currentTime;

    while(audio.arp.nextTime < now + audio.scheduleAhead){
      scheduleArp(audio.arp.nextTime);
      audio.arp.nextTime += secondsPerBeat/2; // 8th notes
    }
    while(audio.drums.nextTime < now + audio.scheduleAhead){
      scheduleDrums(audio.drums.nextTime, audio.drums.step);
      audio.drums.nextTime += secondsPerBeat/4; // 16th
      audio.drums.step = (audio.drums.step + 1) % 16;
    }
  }

  // Musical content
  const progressions = {
    cinematic: [ [57,60,64], [53,57,60], [50,53,57], [55,59,62] ],
    suspense:  [ [58,61,65], [54,58,61], [62,65,68], [58,62,65] ],
    ambient:   [ [57,60,64,67], [55,60,64,67], [50,55,60,64], [55,59,62,67] ],
    lofi:      [ [57,60,64], [52,55,59], [55,59,62], [53,57,60] ],
  };
  const arpPatterns = {
    cinematic: [0,1,2,1,0,2],
    suspense:  [2,1,0,1,2,1],
    ambient:   [0,1,2,3,2,1],
    lofi:      [0,1,0,2,1,2],
  };

  function applyMusicStyle(){
    if(!audio.ctx) return;
    const style = state.settings.musicStyle;
    setPadChordIndex(0);

    // pad filter flavor
    const f = audio.pad[0].filter;
    const now = audio.ctx.currentTime;
    f.frequency.cancelScheduledValues(now);
    if(style==='ambient'){ f.frequency.setTargetAtTime(1000, now, 1.2); }
    else if(style==='cinematic'){ f.frequency.setTargetAtTime(1400, now, 0.9); }
    else if(style==='lofi'){ f.frequency.setTargetAtTime(900, now, 0.8); }
    else { f.frequency.setTargetAtTime(1200, now, 1.0); }

    // base root
    const root = progressions[style][0][0];
    audio.pad[0].osc.frequency.value = midiToFreq(root);
    audio.pad[1].osc.frequency.value = midiToFreq(root);

    // drums level
    audio.drums.bus.gain.value = (style==='ambient') ? 0.08 : (style==='suspense'?0.18:0.22);

    // delay flavor
    audio.delayFeedback.gain.value = (style==='ambient') ? 0.45 : 0.35;
    audio.delayNode.delayTime.value = (style==='lofi') ? 0.32 : (style==='cinematic'?0.28:0.26);
  }

  function setPadChordIndex(i){
    const style = state.settings.musicStyle;
    const chord = progressions[style][i % progressions[style].length];
    const root = chord[0];
    audio.pad[0].osc.frequency.setTargetAtTime(midiToFreq(root), audio.ctx.currentTime, 0.5);
    audio.pad[1].osc.frequency.setTargetAtTime(midiToFreq(root)+0.5, audio.ctx.currentTime, 0.5);
    audio.arp.chord = chord;
    audio.arp.seqIdx = 0;
  }

  function scheduleArp(time){
    const style = state.settings.musicStyle;
    const chord = audio.arp.chord || progressions[style][0];
    const pattern = arpPatterns[style];
    const idx = pattern[audio.arp.seqIdx % pattern.length] % chord.length;
    const note = chord[idx] + 12; // octave up

    audio.arp.osc.frequency.setValueAtTime(midiToFreq(note), time);

    const g = audio.arp.gain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.0, time);
    g.linearRampToValueAtTime(0.35, time + 0.01);
    g.exponentialRampToValueAtTime(0.0001, time + 0.18);

    audio.arp.seqIdx++;
    if(audio.arp.seqIdx % 4 === 0){
      const chordIndex = Math.floor((audio.arp.seqIdx/4)) % progressions[style].length;
      setPadChordIndex(chordIndex);
    }
  }

  function scheduleDrums(time, step){
    const style = state.settings.musicStyle;
    const kickOn = (style==='ambient') ? (step % 8===0) : ([0,4,8,12].includes(step) || (style!=='suspense' && step===10));
    const hatOn  = (style==='ambient') ? ([2,6,10,14].includes(step)) : (step % 2 === 1);
    const snrOn  = (style==='suspense') ? ([4,12].includes(step)) : ([4,12].includes(step));

    if(kickOn) playKick(time);
    if(hatOn) playHat(time, style==='lofi'?0.05:0.035);
    if(snrOn && style!=='ambient') playSnare(time, 0.09);
  }

  function playKick(time){
    const ctx = audio.ctx;
    const o = ctx.createOscillator(); o.type='sine';
    const g = ctx.createGain(); g.gain.value = 0.0;
    o.connect(g).connect(audio.drums.bus);
    o.frequency.setValueAtTime(120, time);
    o.frequency.exponentialRampToValueAtTime(45, time+0.12);
    g.gain.setValueAtTime(0.0, time);
    g.gain.linearRampToValueAtTime(0.7, time+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time+0.18);
    o.start(time); o.stop(time+0.2);
  }

  function playHat(time, level=0.04){
    const ctx = audio.ctx;
    const src = ctx.createBufferSource(); src.buffer = audio.drums.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(hp).connect(g).connect(audio.drums.bus);
    g.gain.setValueAtTime(0.0, time);
    g.gain.linearRampToValueAtTime(level, time+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time+0.06);
    src.start(time); src.stop(time+0.08);
  }

  function playSnare(time, level=0.1){
    const ctx = audio.ctx;
    const src = ctx.createBufferSource(); src.buffer = audio.drums.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(bp).connect(g).connect(audio.drums.bus);
    g.gain.setValueAtTime(0.0, time);
    g.gain.linearRampToValueAtTime(level, time+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time+0.12);
    src.start(time); src.stop(time+0.14);
  }

  // SFX
  function audioTick(){
    if(!audio.ctx) return;
    const ctx = audio.ctx; const now = ctx.currentTime;

    // Click down-chirp
    const o = ctx.createOscillator(); o.type='sine';
    const g = audio.tickGain;
    o.connect(g);
    o.frequency.setValueAtTime(900, now);
    o.frequency.exponentialRampToValueAtTime(280, now + 0.1);
    g.gain.setValueAtTime(0.0, now);
    g.gain.linearRampToValueAtTime(0.6, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    o.start(now); o.stop(now + 0.16);

    // Sidechain ducking
    const mg = audio.musicGain.gain;
    mg.cancelScheduledValues(now);
    const base = audio.baseMusicLevel;
    mg.setValueAtTime(mg.value, now);
    mg.linearRampToValueAtTime(base*0.72, now + 0.02);
    mg.linearRampToValueAtTime(base, now + 0.35);
  }

  function audioStinger(){
    if(!audio.ctx) return;
    const ctx = audio.ctx; const now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type='triangle';
    const g = audio.tickGain;
    o.connect(g);
    o.frequency.setValueAtTime(660, now);
    o.frequency.exponentialRampToValueAtTime(330, now + 0.4);
    g.gain.setValueAtTime(0.0, now);
    g.gain.linearRampToValueAtTime(0.7, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.start(now); o.stop(now + 0.52);
  }

  function pulseLights(){ if(!state.settings.dramatic) return; lights.classList.add('on'); }

  // Volume binding
  volume.addEventListener('input', ()=>{
    if(audio.master){ audio.master.gain.value = clamp(parseInt(volume.value,10)/100, 0, 1); }
  });

  // INIT
  loadFromLocal();
  updateSettingsFromUI();

  // Accessibility shortcuts
  document.addEventListener('keydown', (e)=>{
    if(e.key === ' ' && !btnStart.disabled){ e.preventDefault(); btnStart.click(); }
    if(e.key.toLowerCase() === 'p' && !btnPause.disabled){ e.preventDefault(); btnPause.click(); }
  });
})();
