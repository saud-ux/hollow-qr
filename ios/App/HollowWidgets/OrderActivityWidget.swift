import ActivityKit
import SwiftUI
import WidgetKit

/// The lock-screen and Dynamic Island order tracker. The app starts it when an
/// order is placed; the server moves it on with each status change and ends it
/// when the order is done.
@available(iOSApplicationExtension 16.2, *)
struct OrderActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HollowOrderAttributes.self) { context in
            LockScreenTracker(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Palette.espresso)
                .activitySystemActionForegroundColor(Palette.cream)
                .widgetURL(URL(string: "hollowcoffee://orders/\(context.attributes.orderId)"))
        } dynamicIsland: { context in
            let arabic = context.attributes.lang != "en"
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image("CupFilled").resizable().scaledToFit().frame(width: 30, height: 40)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("#\(context.attributes.orderNumber)")
                        .font(.title3.weight(.heavy))
                        .foregroundColor(Palette.paleGold)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.state.label).font(.headline).foregroundColor(Palette.cream).lineLimit(1)
                        StepBar(step: context.state.step, steps: context.state.steps)
                    }
                    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
                }
            } compactLeading: {
                Image(systemName: "cup.and.saucer.fill").foregroundColor(Palette.gold)
            } compactTrailing: {
                Text(context.state.status == "ready" ? (arabic ? "جاهز" : "Ready") : "#\(context.attributes.orderNumber)")
                    .font(.caption.weight(.bold))
                    .foregroundColor(Palette.paleGold)
            } minimal: {
                Image(systemName: context.state.status == "ready" ? "checkmark.circle.fill" : "cup.and.saucer.fill")
                    .foregroundColor(Palette.gold)
            }
            .widgetURL(URL(string: "hollowcoffee://orders/\(context.attributes.orderId)"))
            .keylineTint(Palette.gold)
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct LockScreenTracker: View {
    let attributes: HollowOrderAttributes
    let state: HollowOrderAttributes.ContentState

    var body: some View {
        let arabic = attributes.lang != "en"
        HStack(spacing: 14) {
            Image(state.status == "ready" ? "CupOpen" : "CupFilled")
                .resizable()
                .scaledToFit()
                .frame(width: 40, height: 52)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image("WordmarkCream").resizable().scaledToFit().frame(height: 12)
                    Spacer(minLength: 0)
                    Text("#\(attributes.orderNumber)")
                        .font(.subheadline.weight(.heavy))
                        .foregroundColor(Palette.paleGold)
                        .environment(\.layoutDirection, .leftToRight)
                }
                Text(state.label)
                    .font(.headline)
                    .foregroundColor(Palette.cream)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                StepBar(step: state.step, steps: state.steps)
            }
        }
        .padding(16)
        .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    }
}

/// One segment per order step; done steps are gold.
private struct StepBar: View {
    let step: Int
    let steps: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(steps, 1), id: \.self) { i in
                Capsule()
                    .fill(i <= step ? Palette.gold : Palette.cream.opacity(0.22))
                    .frame(height: 5)
            }
        }
    }
}
