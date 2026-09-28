Pod::Spec.new do |s|
  s.name           = 'TextReader'
  s.version        = '1.0.0'
  s.summary        = 'On-device text reading for Recall attachments.'
  s.description    = 'Reads the text in an image or PDF with Vision and PDFKit. Nothing leaves the phone.'
  s.license        = 'UNLICENSED'
  s.author         = 'Recall'
  s.homepage       = 'https://github.com/NourMohsen1/Recall-App---2026'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'PDFKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
