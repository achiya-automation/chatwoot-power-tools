# frozen_string_literal: true
#
# One template that takes a picture or a document.
#
# Meta fixes a template's header to one media format: a DOCUMENT template refuses a
# picture and an IMAGE template refuses a PDF. An agent who just wants to "send the
# attached" should not have to keep two templates in their head.
#
# For an account that opts in, every approved template with an IMAGE or DOCUMENT header
# gets one twin on the same WhatsApp Business Account: the same body, footer and buttons,
# the other header format, named <name>__image or <name>__document. When a template goes
# out with a file of the other kind, the twin is sent in its place. The dashboard part
# template-media-upload.js hides the twins and lets the upload button take both kinds.
#
#   account.settings['template_media_twin'] = true
#
# Sending the twin works for every account that has one (it only acts when the twin
# exists); creating twins is what the setting switches on. One twin per template, made
# once after the template is approved: this is a pair, never a series of near-copies.
#
# ponytail: IMAGE <-> DOCUMENT only. A VIDEO twin is the same code with a third suffix
# and a sample clip; add it when someone asks to send a video through a document template.
# ponytail: a twin whose template was deleted stays on the WABA, hidden. Delete orphans
# here if an account ever gets near Meta's template limit.

require 'base64'
require 'uri'

module TemplateMediaTwin
  SETTING = 'template_media_twin'
  SUFFIX = { 'IMAGE' => '__image', 'DOCUMENT' => '__document' }.freeze
  TWIN = /__(image|document)\z/
  EXTENSIONS = {
    'IMAGE' => %w[jpg jpeg png],
    'DOCUMENT' => %w[pdf doc docx ppt pptx xls xlsx txt]
  }.freeze
  MIME = { 'IMAGE' => 'image/png', 'DOCUMENT' => 'application/pdf' }.freeze
  GRAPH = 'https://graph.facebook.com/v21.0'
  MAX_PER_SYNC = 5
  # What Meta's reviewer sees as the twin's header example: a grey placeholder picture
  # and a one-page PDF that says "Sample document".
  SAMPLE = {
    'IMAGE' => <<~B64.delete("\n"),
      iVBORw0KGgoAAAANSUhEUgAAAlgAAAE7CAIAAACOjGjiAAAEzUlEQVR42u3VQQ0AIAwEwfp/4wAT6OHVJxIqA0InGQWX
      SzZ2HgBoK0wAgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBAC
      gBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBAC
      gBACgBACgBACgBACgBACgBACgBACgBACIIRWAEAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAI
      AUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAI
      AUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIAUAIARBCABBCABBCABBCABBCABBCuGDMxcc8HCEE
      IRRCEEIQQiEEIQQhFEIQQhBCIQQhBCEUQhBCEEIhBCEEIRRCEEKEECEEIUQIEUIQQoQQIQQhRAgRQhBChBAhBCFECBFC
      EEKEECEEIUQIEUIQQoQQIQQhRAgRQhBChBAhBCFECBFCEEKEECEEIUQIEUIQQoQQIQQhRAgRQhBChBAhBCFECBFCEEKE
      ECEEIUQIEUIQQoQQIQQhRAgRQoTQBAghQogQghAihAghCCFCiBCCECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFC
      iBCCECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFCiBCCECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFCiBCC
      ECKECCEIoRA6OUIIQiiEIIQghEIIQghCKIQghCCEQghCCEIohCCEIIRCCEKIEKqFEIIQIoQIIQghQogQghAihAghCCFC
      iBCCECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFCiBCCECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFCiBCC
      ECKECCEIIUKIEIIQIoQIIQghQogQghAihAghCCFCiBAihFZACBFChBCEECFECEEIEUKEEIQQIUQIQQgRQoQQhBAhRAhB
      CBFChBCEECFECEEIEUKEEIQQIUQIQQgRQoQQhBAhRAhBCBFChBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAA
      hBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAAhBAA
      hBAAhBAAhBAAhBAAhBAAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQA
      IQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQA
      IQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQQAIQRACK0AgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBACgBAC
      gBACgBACgBACgBACgBACgBACgBACwMsKcfJWY4EUs80AAAAASUVORK5CYII=
    B64
    'DOCUMENT' => <<~B64.delete("\n")
      JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwg
      L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2Ug
      L1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAv
      Rm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NiA+PgpzdHJlYW0KQlQg
      L0YxIDI0IFRmIDcyIDc2MCBUZCAoU2FtcGxlIGRvY3VtZW50KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoK
      PDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAg
      NgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAw
      MTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMzNyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXpl
      IDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwNwolJUVPRgo=
    B64
  }.freeze

  module_function

  # 'IMAGE' or 'DOCUMENT' by the file extension in the URL; nil for anything else.
  def kind_of(url)
    extension = File.extname(URI.parse(url.to_s.strip).path.to_s).delete('.').downcase
    EXTENSIONS.find { |_, list| list.include?(extension) }&.first
  rescue URI::InvalidURIError
    nil
  end

  def header(template)
    Array(template['components']).find { |component| component['type'] == 'HEADER' }
  end

  def twin?(name)
    name.to_s.match?(TWIN)
  end

  def base_name(name)
    name.to_s.sub(TWIN, '')
  end

  def approved?(template)
    template['status'].to_s.casecmp?('approved')
  end

  # The approved template of the same family (the template or its twin) whose header takes `kind`.
  def sibling(templates, template, kind)
    names = [base_name(template['name']), base_name(template['name']) + SUFFIX.fetch(kind)]
    Array(templates).find do |other|
      names.include?(other['name']) && other['language'] == template['language'] &&
        approved?(other) && header(other)&.dig('format') == kind
    end
  end

  # The components of a template with its header turned into `kind`, carrying `handle`
  # (Meta's uploaded example) as the header sample.
  def twin_components(template, kind, handle)
    Array(template['components']).map do |component|
      next component unless component['type'] == 'HEADER'

      { 'type' => 'HEADER', 'format' => kind, 'example' => { 'header_handle' => [handle] } }
    end
  end

  # Everything but the header: what must stay equal between a template and its twin.
  def content(template)
    Array(template['components']).reject { |component| component['type'] == 'HEADER' }
                                 .map { |component| component.except('example') }
  end

  # What to do for the twins of a template list: [[:create, template, kind] | [:update, template, twin, kind]].
  def plan(templates)
    Array(templates).filter_map do |template|
      format = header(template)&.dig('format')
      next unless approved?(template) && SUFFIX.key?(format) && !twin?(template['name'])

      kind = (SUFFIX.keys - [format]).first
      twin = templates.find { |other| other['name'] == template['name'] + SUFFIX[kind] && other['language'] == template['language'] }
      if twin.nil?
        [:create, template, kind]
      elsif approved?(twin) && content(twin) != content(template)
        [:update, template, twin, kind]
      end
    end
  end

  # Creates and refreshes the twins of one channel, straight on Meta's Graph API with the
  # channel's own token. Never raises: a twin that could not be made is tried again a day later.
  class Twins
    def initialize(channel)
      @channel = channel
    end

    def ensure_all
      return unless @channel.provider == 'whatsapp_cloud' && @channel.account.settings&.dig(SETTING)

      TemplateMediaTwin.plan(@channel.message_templates).first(MAX_PER_SYNC).each { |step| run(*step) }
    rescue StandardError => e
      Rails.logger.warn "[template_media_twin] channel #{@channel.id}: #{e.class}"
    end

    private

    def run(action, template, *rest)
      kind = rest.last
      key = "cwpt:template_media_twin:#{@channel.id}:#{template['name']}:#{template['language']}:#{action}"
      return if ::Redis::Alfred.get(key)

      # One attempt a day per twin, whatever the outcome: Meta limits edits of an approved
      # template, and a twin it refuses must not be re-submitted on every sync.
      ::Redis::Alfred.setex(key, 1, 24 * 60 * 60)
      components = TemplateMediaTwin.twin_components(template, kind, upload_sample(kind))
      response = action == :create ? create(template, kind, components) : update(rest.first, components)
      Rails.logger.info "[template_media_twin] channel #{@channel.id} #{action} #{template['name']}#{SUFFIX[kind]}: " \
                        "#{response.code} #{response.parsed_response.is_a?(Hash) ? response.parsed_response.dig('error', 'message') : nil}"
    end

    def create(template, kind, components)
      post("#{GRAPH}/#{@channel.provider_config['business_account_id']}/message_templates",
           name: template['name'] + SUFFIX[kind], language: template['language'],
           category: template['category'], components: components)
    end

    def update(twin, components)
      post("#{GRAPH}/#{twin['id']}", components: components)
    end

    def post(url, body)
      HTTParty.post(url, headers: bearer.merge('Content-Type' => 'application/json'), body: body.to_json)
    end

    # Meta's Resumable Upload: open a session on the app behind the token, push the bytes,
    # get back the handle a template header example needs.
    def upload_sample(kind)
      bytes = Base64.decode64(SAMPLE.fetch(kind))
      app_id = HTTParty.get("#{GRAPH}/app?fields=id", headers: bearer).parsed_response['id']
      session = HTTParty.post("#{GRAPH}/#{app_id}/uploads", headers: bearer,
                                                            query: { file_length: bytes.bytesize, file_type: MIME.fetch(kind) })
      upload = HTTParty.post("#{GRAPH}/#{session.parsed_response['id']}",
                             headers: { 'Authorization' => "OAuth #{token}", 'file_offset' => '0' }, body: bytes)
      upload.parsed_response['h'] || raise(ArgumentError, 'no media handle')
    end

    def token
      @channel.provider_config['api_key']
    end

    def bearer
      { 'Authorization' => "Bearer #{token}" }
    end
  end
end

Rails.application.config.to_prepare do
  # Sending: a file of the other kind goes out through the twin.
  module TemplateMediaTwinProcessor
    def call
      swap_to_media_twin
      super
    end

    private

    def swap_to_media_twin
      media = template_params.is_a?(Hash) && template_params.dig('processed_params', 'header')
      return unless media.is_a?(Hash) && media['media_url'].present?

      template = find_template
      kind = TemplateMediaTwin.kind_of(media['media_url'])
      format = template && TemplateMediaTwin.header(template)&.dig('format')
      return if kind.nil? || kind == format || !TemplateMediaTwin::SUFFIX.key?(format)

      twin = TemplateMediaTwin.sibling(channel.message_templates, template, kind)
      return if twin.nil?

      # A copy: the message keeps the template the agent picked, only this send changes.
      @template_params = template_params.deep_dup
      @template_params['name'] = twin['name']
      header = @template_params['processed_params']['header']
      header['media_type'] = kind.downcase
      header['media_name'] = media_file_name(media['media_url']) if kind == 'DOCUMENT' && header['media_name'].blank?
    end

    # The name the file was uploaded with (the addons engine keeps it), so the recipient
    # does not get a document called after a random id. Falls back to the URL's own name.
    def media_file_name(url)
      file = File.basename(URI.parse(url).path)
      ActiveRecord::Base.connection.select_value(
        ActiveRecord::Base.sanitize_sql_array(['SELECT orig_name FROM drip.media WHERE file = ? LIMIT 1', file])
      ).presence || file
    rescue StandardError
      file
    end
  end

  processor = Whatsapp::TemplateProcessorService
  processor.prepend(TemplateMediaTwinProcessor) unless processor.ancestors.include?(TemplateMediaTwinProcessor)

  # Creating: after every template sync, make or refresh the twins of an opted-in account.
  module TemplateMediaTwinSync
    def sync_templates
      super
      TemplateMediaTwin::Twins.new(whatsapp_channel).ensure_all
    end
  end

  provider = Whatsapp::Providers::WhatsappCloudService
  provider.prepend(TemplateMediaTwinSync) unless provider.ancestors.include?(TemplateMediaTwinSync)
end
