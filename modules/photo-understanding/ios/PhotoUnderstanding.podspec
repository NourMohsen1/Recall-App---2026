Pod::Spec.new do |s|
  s.name           = 'PhotoUnderstanding'
  s.version        = '1.0.0'
  s.summary        = 'On-device photo understanding for Recall.'
  s.description    = 'Apple Vision labels and a SigLIP 2 image embedding, computed on the phone. Nothing leaves the device.'
  s.license        = 'UNLICENSED'
  s.author         = 'Recall'
  s.homepage       = 'https://github.com/NourMohsen1/Recall-App---2026'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreML', 'Photos'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "*.{h,m,swift}"
  # The compiled model (see tools/photo-model). Built locally, not in git.
  s.resource_bundles = { 'PhotoUnderstandingModels' => ['models/*.mlmodelc'] }
end
