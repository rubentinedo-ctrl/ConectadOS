export const escapeXML=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const reportDate=at=>at?new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(at)+' UTC':'Sin fecha';
