/** Recording-only observations; never imported by the application. No input values are collected. */
export const MOTION_PROBE_SOURCE = `(function () {
  if (window.__motionProbe) return;
  var probe = window.__motionProbe = { samples: [], events: [], started: performance.now(), timeOrigin: performance.timeOrigin };
  var sent=0,eventsSent=0,lastFlush=0;
  probe.flush=function(){if(typeof window.__reviewMotionSink==='function'){window.__reviewMotionSink({timeOrigin:probe.timeOrigin,started:probe.started,samples:probe.samples.slice(sent),events:probe.events.slice(eventsSent)});sent=probe.samples.length;eventsSent=probe.events.length;}};
  document.addEventListener('pointerdown',function(event){var n=event.target.closest('button,summary,[role=tab],[role=radio]');if(n)probe.events.push({t:performance.now()-probe.started,action:n.textContent.trim().slice(0,70),label:n.getAttribute('aria-label')});},true);
  var last = 0, signature = '';
  function rect(node) { if (!node) return null; var r=node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(function(v){return Math.round(v*100)/100;}); }
  function sample(now) {
    requestAnimationFrame(sample);
    if(now-lastFlush>300){lastFlush=now;probe.flush();}
    if (now-last<32 || probe.samples.length>=15000) return; last=now;
    var artifact=document.querySelector('.artifact'), pdf=document.querySelector('.document-preview'), graph=document.querySelector('.task-graph'), context=document.querySelector('.context-inspector');
    var phase=[pdf&&pdf.dataset.previewState,pdf&&pdf.dataset.exportHandoff,graph&&graph.textContent.trim().slice(-100),context&&context.textContent.trim().slice(-70)].join('|');
    if(phase!==signature){signature=phase;probe.events.push({t:now-probe.started,phase:phase});}
    probe.samples.push({t:Math.round((now-probe.started)*100)/100,artifact:rect(artifact),pdf:rect(pdf&&pdf.querySelector('canvas')),pdfScroll:pdf&&pdf.querySelector('.document-preview-scroll').scrollTop,
      signatureClip:(function(){var n=document.querySelector('.signature-image-preview');return n?getComputedStyle(n).clipPath:null;})(),
      graph:rect(graph),nodes:Array.from(document.querySelectorAll('.task-graph [data-node-id]')).slice(0,12).map(function(n){return {id:n.dataset.nodeId,rect:rect(n)};}),
      regions:Array.from(document.querySelectorAll('.task-motion-region')).slice(0,12).map(function(n){return {h:rect(n)[3],phase:n.dataset.motionPhase,open:n.dataset.open};}),
      paths:Array.from(document.querySelectorAll('.task-graph path')).slice(0,15).map(function(n){return n.getAttribute('d');}),
      cells:Array.from(document.querySelectorAll('.task-table td')).slice(0,18).map(function(n){return {rect:rect(n),background:getComputedStyle(n).backgroundColor,text:n.textContent.slice(0,30)};}),
      bands:Array.from(document.querySelectorAll('.context-inspector-body,.context-inspector header,.context-inspector footer')).slice(0,8).map(function(n){return {rect:rect(n),opacity:getComputedStyle(n).opacity};}),
      context:rect(context),animations:document.getAnimations().filter(function(a){return a.playState==='running';}).length});
  }
  requestAnimationFrame(sample);
})();`;
