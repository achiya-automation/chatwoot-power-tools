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

# --- outgoing: markdown -> WhatsApp ---------------------------------------
raise 'out bold' unless W.markdown_to_whatsapp('יש לך **מחר** פגישה') == 'יש לך *מחר* פגישה'
raise 'out italic' unless W.markdown_to_whatsapp('טקסט *נטוי* כאן') == 'טקסט _נטוי_ כאן'
raise 'out strike' unless W.markdown_to_whatsapp('זה ~~ירד~~') == 'זה ~ירד~'
raise 'out link' unless W.markdown_to_whatsapp('[אתר](https://a.co/x)') == 'אתר (https://a.co/x)'
raise 'out hard break spaces' unless W.markdown_to_whatsapp("א  \nב") == "א\nב"
raise 'out backslash break' unless W.markdown_to_whatsapp("א\\\nב") == "א\nב"
raise 'out bullets' unless W.markdown_to_whatsapp("- אחת\n- שתיים") == "* אחת\n* שתיים"
raise 'out newline kept' unless W.markdown_to_whatsapp("א\nב\n\nג") == "א\nב\n\nג"

puts 'whatsapp_text_style: all checks passed'
