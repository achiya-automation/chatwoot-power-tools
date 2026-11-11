# frozen_string_literal: true

require 'minitest/autorun'

# The initializer's Rails half only runs inside Chatwoot; the rules live in a plain module.
module Rails
  def self.application = Struct.new(:config).new(Struct.new(:x) { def to_prepare; end }.new)
end
class Hash
  def except(*keys) = reject { |key, _| keys.include?(key) } unless method_defined?(:except)
end

require_relative '../template_media_twin'

class TemplateMediaTwinTest < Minitest::Test
  def template(name, format, body: 'Attached {{1}}', status: 'APPROVED', language: 'he', id: nil)
    { 'id' => id, 'name' => name, 'language' => language, 'status' => status, 'category' => 'MARKETING',
      'components' => [
        { 'type' => 'HEADER', 'format' => format, 'example' => { 'header_handle' => ['https://meta.test/sample'] } },
        { 'type' => 'BODY', 'text' => body, 'example' => { 'body_text' => [['x']] } }
      ] }
  end

  def test_the_kind_of_a_file_comes_from_its_extension
    assert_equal 'IMAGE', TemplateMediaTwin.kind_of('https://cdn.test/media/a.JPG')
    assert_equal 'IMAGE', TemplateMediaTwin.kind_of(' https://cdn.test/media/a.png?v=2 ')
    assert_equal 'DOCUMENT', TemplateMediaTwin.kind_of('https://cdn.test/media/a.pdf')
    assert_nil TemplateMediaTwin.kind_of('https://cdn.test/media/a.mp4')
    assert_nil TemplateMediaTwin.kind_of('https://cdn.test/media/file')
    assert_nil TemplateMediaTwin.kind_of('not a url %%')
  end

  def test_a_picture_through_a_document_template_finds_the_image_twin_and_back
    document = template('offer', 'DOCUMENT')
    image = template('offer__image', 'IMAGE')
    list = [document, image, template('other__image', 'IMAGE')]
    assert_equal image, TemplateMediaTwin.sibling(list, document, 'IMAGE')
    assert_equal document, TemplateMediaTwin.sibling(list, image, 'DOCUMENT')
  end

  def test_a_twin_that_is_not_approved_or_in_another_language_is_not_used
    document = template('offer', 'DOCUMENT')
    assert_nil TemplateMediaTwin.sibling([document, template('offer__image', 'IMAGE', status: 'PENDING')], document, 'IMAGE')
    assert_nil TemplateMediaTwin.sibling([document, template('offer__image', 'IMAGE', language: 'en')], document, 'IMAGE')
    assert_nil TemplateMediaTwin.sibling([document], document, 'IMAGE')
  end

  def test_the_twin_keeps_everything_but_the_header
    components = TemplateMediaTwin.twin_components(template('offer', 'DOCUMENT'), 'IMAGE', 'handle-1')
    assert_equal({ 'type' => 'HEADER', 'format' => 'IMAGE', 'example' => { 'header_handle' => ['handle-1'] } }, components[0])
    assert_equal 'Attached {{1}}', components[1]['text']
  end

  def test_the_plan_creates_a_missing_twin_once_and_never_a_twin_of_a_twin
    list = [template('offer', 'DOCUMENT'), template('photo', 'IMAGE'), template('photo__document', 'DOCUMENT'),
            template('plain', 'TEXT'), template('draft', 'IMAGE', status: 'PENDING')]
    assert_equal [[:create, list[0], 'IMAGE']], TemplateMediaTwin.plan(list)
  end

  def test_the_plan_updates_an_approved_twin_whose_text_fell_behind_and_leaves_a_pending_one_alone
    base = template('offer', 'DOCUMENT', body: 'New text {{1}}')
    stale = template('offer__image', 'IMAGE', id: '77')
    assert_equal [[:update, base, stale, 'IMAGE']], TemplateMediaTwin.plan([base, stale])
    assert_empty TemplateMediaTwin.plan([base, template('offer__image', 'IMAGE', status: 'PENDING')])
    assert_empty TemplateMediaTwin.plan([base, template('offer__image', 'IMAGE', body: 'New text {{1}}')])
  end

  def test_the_samples_are_a_real_png_and_a_real_pdf
    assert Base64.decode64(TemplateMediaTwin::SAMPLE['IMAGE']).start_with?("\x89PNG".b)
    assert Base64.decode64(TemplateMediaTwin::SAMPLE['DOCUMENT']).start_with?('%PDF')
  end
end
