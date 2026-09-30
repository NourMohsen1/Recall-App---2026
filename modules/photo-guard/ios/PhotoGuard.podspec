Pod::Spec.new do |s|
  s.name           = 'PhotoGuard'
  s.version        = '1.0.0'
  s.summary        = 'On-device private-photo check for Recall.'
  s.description    = 'Checks photos for nudity on the phone before they enter the app, and which library photos still exist.'
  s.license        = 'UNLICENSED'
  s.author         = 'Recall'
  s.homepage       = 'https://github.com/NourMohsen1/Recall-App---2026'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreML', 'Photos'
  s.weak_frameworks = 'SensitiveContentAnalysis'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "*.{h,m,swift}"
  # Marqo nsfw-image-detection-384, compiled (11 MB). Rebuilt from
  # tools/privacy-model/convert.py; kept in git so every build has it.
  s.resource_bundles = { 'PhotoGuardModels' => ['models/*.mlmodelc'] }
end
