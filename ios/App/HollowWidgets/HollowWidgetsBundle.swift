import SwiftUI
import WidgetKit

/// Everything the HOLLOW app shows outside itself: the card widget (home and
/// lock screen) and the lock-screen order tracker.
@main
struct HollowWidgetsBundle: WidgetBundle {
    var body: some Widget {
        CardWidget()
        OrderActivityWidget()
    }
}
