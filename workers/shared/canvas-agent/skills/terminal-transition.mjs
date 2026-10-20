export default Object.freeze({id:'terminal-transition',version:1,
  purpose:'Keep montage joins valid at the final clip.',
  when:'Planning or correcting an ordered Canvas assembly.',
  context:'Current plan schema, playback order and supported transition inventory.',
  operations:'Return a strictly validated production plan; no execution authority.',
  result:'Every transition joins its owning clip to the following clip. The final clip has transition {"preset":"none"}.',
  recovery:'Correct the specific invalid relationship without deleting scenes or relaxing graph and spending checks.',
  text:'The transition field belongs to the outgoing join, not the incoming join. A dissolve on the last clip is invalid because there is no following clip. Do not encode a fade-out as an outgoing montage transition. Keep valid earlier joins and all intended footage.'});
