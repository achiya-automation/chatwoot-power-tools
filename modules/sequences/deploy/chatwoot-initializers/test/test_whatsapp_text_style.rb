# frozen_string_literal: true
# Standalone check for whatsapp_text_style.rb (no Rails needed):
#   ruby modules/sequences/deploy/chatwoot-initializers/test/test_whatsapp_text_style.rb

require_relative '../whatsapp_text_style'

W = WhatsappTextStyle

# --- incoming: WhatsApp markup -> markdown -------------------------------
raise 'bold' unless W.whatsapp_to_markdown('שלום *עולם* טוב') == 'שלום **עולם** טוב'
raise 'strike' unless W.whatsapp_to_markdown('זה ~בוטל~ עכשיו') == 'זה ~~בוטל~~ עכשיו'
# already-markdown bold stays untouched (bridge-converted content, idempotency)
raise 'idempotent' unless W.whatsapp_to_markdown('שלום **עולם**') == 'שלום **עולם**'
# asterisks inside URLs survive
url = 'ראו https://x.co/a*b*c בבקשה'
raise 'url-protect' unless W.whatsapp_to_markdown(url) == url
# mid-word asterisk (math) is not emphasis
raise 'math' unless W.whatsapp_to_markdown('5*3*2') == '5*3*2'

# --- hard breaks ----------------------------------------------------------
raise 'soft break' unless W.hard_breaks("א\nב") == "א  \nב"
raise 'paragraph kept' unless W.hard_breaks("א\n\nב") == "א\n\nב"
raise 'backslash break kept' unless W.hard_breaks("א\\\nב") == "א\\\nב"
raise 'existing hard break kept' unless W.hard_breaks("א  \nב") == "א  \nב"

# --- outgoing: only the gaps WhatsAppRenderer leaves -----------------------
# markdown_to_whatsapp runs on the OUTPUT of Chatwoot's own render_whatsapp, not
# on raw markdown. It used to redo that conversion, so every send was converted
# twice and the second pass re-read the first pass's output: "**bold**" became
# "*bold*" became "_bold_", and customers got italic where bold was meant.
raise 'out strike' unless W.markdown_to_whatsapp('זה ~~ירד~~') == 'זה ~ירד~'
raise 'out bullets' unless W.markdown_to_whatsapp("- אחת\n- שתיים") == "* אחת\n* שתיים"
raise 'out hard break spaces' unless W.markdown_to_whatsapp("א  \nב") == "א\nב"
raise 'out newline kept' unless W.markdown_to_whatsapp("א\nב\n\nג") == "א\nב\n\nג"
# what render_whatsapp already emitted must pass through untouched
raise 'no double bold' unless W.markdown_to_whatsapp('יש לך *מחר* פגישה') == 'יש לך *מחר* פגישה'
raise 'no double italic' unless W.markdown_to_whatsapp('טקסט _נטוי_ כאן') == 'טקסט _נטוי_ כאן'
raise 'no double link' unless W.markdown_to_whatsapp('https://a.co/x') == 'https://a.co/x'

# --- dial codes ------------------------------------------------------------
# A dial code is markdown too, so a parser eats the asterisks that make it
# dialable. Backticks stop that; WhatsAppRenderer#code drops them on the way out.
raise 'shield register' unless W.shield_dial_codes('חייגו **61*033825601**10#') == 'חייגו `**61*033825601**10#`'
raise 'shield activate' unless W.shield_dial_codes('חייגו *61*0338*10#') == 'חייגו `*61*0338*10#`'
raise 'shield cancel' unless W.shield_dial_codes('לניתוק ##002#') == 'לניתוק `##002#`'
raise 'shield check' unless W.shield_dial_codes('לבדיקה *#61#') == 'לבדיקה `*#61#`'
# idempotent: the sender may have shielded its own codes already, and rewrapping
# would match the asterisks INSIDE the span and destroy the code
once = W.shield_dial_codes('חייגו **61*033825601**10#')
raise 'shield idempotent' unless W.shield_dial_codes(once) == once
raise 'pre-shielded kept' unless W.shield_dial_codes('חייגו `**61*0338**5#`') == 'חייגו `**61*0338**5#`'
raise 'fenced block kept' unless W.shield_dial_codes("```\n**61*0338**5#\n```") == "```\n**61*0338**5#\n```"
# ordinary text must not be mistaken for a code
['המחיר 29 ₪ לחודש', 'חייגו 03-3825601', 'שלום **עולם**', '## כותרת', "5*3*2"].each do |plain|
  raise "false positive: #{plain}" unless W.shield_dial_codes(plain) == plain
end

puts 'whatsapp_text_style: all checks passed'
