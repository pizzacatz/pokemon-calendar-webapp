const DEFAULT_SRC = 'https://pokedata.ovh/events/api/_tcg/cups/challenges/_go/cups/_vg/challenges/_country/US/_state/GA/Georgia/_start/2025-08-20/ics';

function doGet(e) {
  const src = (e && e.parameter && e.parameter.src) ? e.parameter.src : DEFAULT_SRC;
  const prefix = (e && e.parameter && e.parameter.prefix) ? e.parameter.prefix : ''; // e.g., "TCG "
  const res = UrlFetchApp.fetch(src, {muteHttpExceptions: true});
  if (res.getResponseCode() >= 400) return _resp('Upstream error', 502);

  // Unfold lines (RFC 5545)
  const lines = res.getContentText().replace(/\r\n/g, '\n').split('\n');
  const unfolded = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) line += lines[++i].replace(/^[ \t]/, '');
    unfolded.push(line);
  }
  let text = unfolded.join('\n');

  // Rewrite each VEVENT
  text = text.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g, block => {
    const descLine = _match1(block, /^DESCRIPTION(?:;[^:]*)?:(.*)$/mi) || '';
    const { href, inner } = _parseAnchor(descLine); // inner like "League Challenge @ SHOP"
    let summary = inner || _match1(block, /^SUMMARY(?:;[^:]*)?:(.*)$/mi) || '';

    // Remove "League" and normalize spacing
    summary = _unescapeICS(summary)
      .replace(/\bLeague\b/gi, '')
      .replace(/\s*@\s*/g, ' @ ')
      .replace(/\s+/g, ' ')
      .trim();

    // If no "@", rebuild from inner text
    if (!/@/.test(summary) && inner) {
      const m = inner.replace(/\bLeague\b/gi, '').split('@');
      if (m.length === 2) summary = (m[0].trim() + ' @ ' + m[1].trim()).replace(/\s+/g, ' ').trim();
    }

    // Optional prefix (e.g., "TCG ", "VGC ", "GO ")
    if (prefix) summary = `${prefix}${summary}`.trim();

    // Write SUMMARY and DESCRIPTION
    if (summary) block = _setProp(block, 'SUMMARY', summary);
    const descOut = (href || _match1(block, /^URL:(.*)$/mi) || '').trim();
    block = _setProp(block, 'DESCRIPTION', descOut);

    // Change signals for Google Calendar
    const now = _nowICS();
    block = _setProp(block, 'LAST-MODIFIED', now);
    block = _setProp(block, 'DTSTAMP', now);
    block = _bumpSequence(block);

    return block;
  });

  // Fold long lines (~74 chars)
  text = text.split('\n').map(_fold).join('\n');
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/* Helpers */
function _match1(s, re){ const m = s.match(re); return m ? m[1] : ''; }
function _parseAnchor(descLine){
  const href = (descLine.match(/href="([^"]+)"/i) || [,''])[1];
  let inner = descLine.replace(/.*?>/,'').replace(/<\/a>.*/i,'');
  inner = inner.replace(/<[^>]*>/g,'');
  inner = _unescapeICS(inner);
  return { href, inner: inner.trim() };
}
function _setProp(block, name, value){
  const line = `${name}:${_escapeICS(value)}`;
  const re = new RegExp(`^${name}(?:;[^:]*)?:.*$`, 'mi');
  if (re.test(block)) return block.replace(re, line);
  const after = block.replace(/^DTSTART[^\n]*\n/im, m => m + line + '\n');
  if (after !== block) return after;
  return block.replace(/BEGIN:VEVENT\n/i, m => m + line + '\n');
}
function _bumpSequence(block){
  const m = block.match(/^SEQUENCE:(\d+)$/mi);
  const next = (m ? (parseInt(m[1],10) || 0) : 0) + 1;
  return _setProp(block, 'SEQUENCE', String(next));
}
function _nowICS(){
  const d = new Date();
  return Utilities.formatDate(d, 'Etc/UTC', "yyyyMMdd'T'HHmmss'Z'");
}
function _unescapeICS(s){ return String(s||'').replace(/\\n/g,' ').replace(/\\,/g,',').replace(/\\;/g,';').trim(); }
function _escapeICS(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function _fold(s){ if (s.length<=74) return s; let out=''; for (let i=0;i<s.length;i+=74) out+=(i?'\n ':'')+s.slice(i,i+74); return out; }
function _resp(msg, code){ return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT).setResponseCode(code||200); }
