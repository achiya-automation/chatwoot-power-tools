// The box inside Chatwoot's New import dialog. Colors are Chatwoot's own variables
// (_next-colors.scss), so light and dark follow the dashboard; selects and inputs keep
// Chatwoot's global field look (_base.scss) and only lose its form margins and height.
export const STYLES = `
.cwi-box{border:1px solid rgb(var(--border-weak));border-radius:.75rem;padding:.875rem;min-width:0}
/* Chatwoot's CSV preview shows the converted file; the mapping table replaces it. */
.cwi-box ~ section{display:none!important}
.cwi-fs{display:flex;flex-direction:column;gap:1.125rem;min-width:0;margin:0;padding:0;border:0}
.cwi-sec{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.cwi-sec.cwi-tight{gap:.375rem}
.cwi-h,.cwi-hint{margin:0}
.cwi-scroll{overflow-x:auto;min-width:0}
.cwi-map{width:100%;border:1px solid rgb(var(--border-weak));border-radius:.625rem;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:.8125rem;color:rgb(var(--slate-12))}
.cwi-map th,.cwi-map td{padding:.5rem .75rem;text-align:start;vertical-align:middle;border-bottom:1px solid rgb(var(--border-weak))}
.cwi-map tbody tr:last-child td{border-bottom:0}
.cwi-map th{background:rgb(var(--slate-2));font-weight:500;color:rgb(var(--slate-11))}
.cwi-map td:last-child{width:45%;min-width:9rem}
.cwi-col{overflow-wrap:anywhere}
.cwi-auto{display:block;font-size:.6875rem;color:rgb(var(--teal-11))}
.cwi-sample{color:rgb(var(--slate-11));max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwi-box select,.cwi-box input[type=text]{margin:0!important;height:2rem;padding-top:0;padding-bottom:0;font-size:.8125rem}
.cwi-edit{display:flex;gap:.375rem;align-items:center}
.cwi-edit input{flex:1;min-width:0}
.cwi-btn{flex:none;height:2rem;padding:0 .75rem;border-radius:.5rem;font-size:.8125rem;font-weight:500;color:rgb(var(--slate-12));background:transparent;outline:1px solid rgb(var(--border-strong));outline-offset:-1px}
.cwi-btn.cwi-primary{color:#fff;background:rgb(var(--blue-9));outline:0}
.cwi-btn:focus-visible{outline:2px solid rgb(var(--blue-9));outline-offset:2px}
.cwi-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}
.cwi-stat{border:1px solid rgb(var(--border-weak));border-radius:.625rem;padding:.5rem .625rem;background:rgb(var(--solid-1));min-width:0}
.cwi-stat b{display:block;font-size:1.0625rem;font-weight:600;color:rgb(var(--slate-12))}
.cwi-stat span{display:block;font-size:.75rem;line-height:1.3;color:rgb(var(--slate-11))}
.cwi-err{border-radius:.625rem;padding:.625rem .75rem;font-size:.8125rem;background:rgb(var(--ruby-3));color:rgb(var(--ruby-11))}
.cwi-err[hidden],.cwi-box [hidden]{display:none}
@media (max-width:760px){.cwi-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cwi-sm-hide{display:none}.cwi-map th,.cwi-map td{padding:.5rem}.cwi-map td:last-child{width:58%}}
/* Phones: a row per column, the field picker under its name, so no option is cut off. */
@media (max-width:480px){.cwi-map,.cwi-map tbody{display:block}.cwi-map thead{display:none}.cwi-map tr{display:flex;flex-direction:column;gap:.375rem;padding:.625rem .75rem;border-bottom:1px solid rgb(var(--border-weak))}.cwi-map tbody tr:last-child{border-bottom:0}.cwi-map td:not(.cwi-sm-hide){display:block;width:auto;min-width:0;padding:0;border:0}.cwi-auto{display:inline;margin-inline-start:.5rem}}
`;
