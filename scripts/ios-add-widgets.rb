# Adds the HollowWidgets extension (home-screen widget + lock-screen order
# tracker) to ios/App/App.xcodeproj without Xcode. Safe to run again: it does
# nothing when the target already exists.
#
#   gem install xcodeproj && ruby scripts/ios-add-widgets.rb
require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
project_path = File.join(ROOT, "ios/App/App.xcodeproj")
project = Xcodeproj::Project.open(project_path)

TEAM = "N2KXQ7MVY3"
NAME = "HollowWidgets"
BUNDLE_ID = "com.hollowzulfi.coffee.widgets"
PROFILE = "HOLLOW Coffee Widgets App Store"

app = project.targets.find { |t| t.name == "App" } or abort "App target not found"
if project.targets.any? { |t| t.name == NAME }
  puts "#{NAME} already in the project"
  exit 0
end

marketing = app.build_configurations.first.build_settings["MARKETING_VERSION"] || "1.0"

# Files: the extension's own folder, and code shared with the app.
widgets_group = project.main_group.find_subpath(NAME, true)
widgets_group.set_source_tree("<group>")
widgets_group.set_path(NAME)
shared_group = project.main_group.find_subpath("Shared", true)
shared_group.set_source_tree("<group>")
shared_group.set_path("Shared")

ext = project.new_target(:app_extension, NAME, :ios, "16.2", nil, :swift)

swift = %w[HollowWidgetsBundle.swift CardWidget.swift OrderActivityWidget.swift].map { |f| widgets_group.new_reference(f) }
assets = widgets_group.new_reference("Assets.xcassets")
widgets_group.new_reference("Info.plist")
widgets_group.new_reference("#{NAME}.entitlements")
shared = shared_group.new_reference("HollowShared.swift")

ext.add_file_references(swift + [shared])
ext.add_resources([assets])

# The app's plugin and the shared model.
app_group = project.main_group["App"] or abort "App group not found"
plugin = app_group.new_reference("HollowWidgetPlugin.swift")
app.add_file_references([plugin, shared])

ext.build_configurations.each do |config|
  s = config.build_settings
  s["PRODUCT_BUNDLE_IDENTIFIER"] = BUNDLE_ID
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["INFOPLIST_FILE"] = "#{NAME}/Info.plist"
  s["CODE_SIGN_ENTITLEMENTS"] = "#{NAME}/#{NAME}.entitlements"
  s["GENERATE_INFOPLIST_FILE"] = "NO"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.2"
  s["SWIFT_VERSION"] = "5.0"
  s["TARGETED_DEVICE_FAMILY"] = "1"
  s["MARKETING_VERSION"] = marketing
  s["CURRENT_PROJECT_VERSION"] = "1"
  s["DEVELOPMENT_TEAM"] = TEAM
  s["SKIP_INSTALL"] = "YES"
  s["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
  s["ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME"] = ""
  s["ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME"] = ""
  if config.name == "Release"
    s["CODE_SIGN_STYLE"] = "Manual"
    s["CODE_SIGN_IDENTITY"] = "Apple Distribution"
    s["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
    s["PROVISIONING_PROFILE_SPECIFIER"] = PROFILE
  else
    s["CODE_SIGN_STYLE"] = "Automatic"
  end
end

# The app keeps iOS 15: ActivityKit (iOS 16.1+) is linked weakly.
app.build_configurations.each do |config|
  flags = Array(config.build_settings["OTHER_LDFLAGS"] || ["$(inherited)"])
  flags += ["-weak_framework", "ActivityKit"] unless flags.include?("ActivityKit")
  config.build_settings["OTHER_LDFLAGS"] = flags
end

# Build the extension with the app and embed it in the app bundle.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase("Embed Foundation Extensions")
embed.symbol_dst_subfolder_spec = :plug_ins
file = embed.add_file_reference(ext.product_reference, true)
file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

project.save
puts "Added #{NAME} (#{BUNDLE_ID}) to the project"
