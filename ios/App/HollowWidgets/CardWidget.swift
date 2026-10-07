import SwiftUI
import UIKit
import WidgetKit
import CoreImage.CIFilterBuiltins

// MARK: - Timeline

struct CardEntry: TimelineEntry {
    let date: Date
    let state: HollowWidgetState?
}

/// Reads what the app stored, refreshes it from the server with the widget
/// token, and asks to be refreshed often only while an order is in progress.
struct CardProvider: TimelineProvider {
    func placeholder(in context: Context) -> CardEntry {
        CardEntry(date: Date(), state: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (CardEntry) -> Void) {
        completion(CardEntry(date: Date(), state: context.isPreview ? (HollowSharedStore.read() ?? .sample) : HollowSharedStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CardEntry>) -> Void) {
        let stored = HollowSharedStore.read()
        refresh(stored) { state in
            let active = state?.order != nil
            let next = Calendar.current.date(byAdding: .minute, value: active ? 5 : 120, to: Date()) ?? Date()
            completion(Timeline(entries: [CardEntry(date: Date(), state: state)], policy: .after(next)))
        }
    }

    private func refresh(_ stored: HollowWidgetState?, done: @escaping (HollowWidgetState?) -> Void) {
        guard var state = stored, let token = state.token, let base = state.apiBase,
              let url = URL(string: "\(base)/api/widget") else {
            done(stored)
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("Widget \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 {
                // Signed out or the token ran out: show the signed-out widget.
                state.card = nil
                state.order = nil
                state.token = nil
                HollowSharedStore.write(state)
                done(state)
                return
            }
            guard status == 200, let data = data, let fresh = try? JSONDecoder().decode(HollowWidgetData.self, from: data) else {
                done(stored)
                return
            }
            state.card = fresh.card
            state.order = fresh.order
            state.updatedAt = Date()
            HollowSharedStore.write(state)
            done(state)
        }.resume()
    }
}

extension HollowWidgetState {
    static let sample = HollowWidgetState(
        card: Card(name: "HOLLOW", stamps: 3, max: 5, reward: false, active: true, qr: "https://hollow-rewards.hollowzulfi.workers.dev"),
        order: nil,
        lang: deviceIsArabic ? "ar" : "en",
        token: nil,
        apiBase: nil,
        updatedAt: nil
    )
}

// MARK: - Look

/// The widget gallery is shown before the app has told us its language.
let deviceIsArabic = Locale.preferredLanguages.first?.hasPrefix("ar") ?? true

enum Palette {
    static let espresso = Color(red: 43 / 255, green: 30 / 255, blue: 22 / 255)
    static let cream = Color(red: 244 / 255, green: 237 / 255, blue: 224 / 255)
    static let gold = Color(red: 201 / 255, green: 162 / 255, blue: 39 / 255)
    static let label = Color(red: 140 / 255, green: 98 / 255, blue: 57 / 255)
    static let paleGold = Color(red: 240 / 255, green: 215 / 255, blue: 122 / 255)

    /// Cream by day, espresso at night.
    static let background = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.09, green: 0.067, blue: 0.05, alpha: 1) : UIColor(red: 0.957, green: 0.929, blue: 0.878, alpha: 1) })
    static let ink = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.945, green: 0.91, blue: 0.855, alpha: 1) : UIColor(red: 0.169, green: 0.118, blue: 0.086, alpha: 1) })
    static let soft = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.84, green: 0.68, blue: 0.42, alpha: 1) : UIColor(red: 0.55, green: 0.384, blue: 0.224, alpha: 1) })
}

extension View {
    /// iOS 17 wants the background declared; older systems just get it painted.
    @ViewBuilder func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            background(color)
        }
    }
}

/// A crisp QR code for the member card, scanned at the counter.
struct QRImage: View {
    let payload: String

    var body: some View {
        if let image = Self.render(payload) {
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
        } else {
            Color.clear
        }
    }

    static func render(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// The five cups of the card, filled up to `stamps`.
struct CupRow: View {
    let stamps: Int
    let max: Int
    var size: CGFloat = 18

    var body: some View {
        HStack(spacing: size * 0.22) {
            ForEach(0..<max, id: \.self) { i in
                Image(i < stamps ? "CupFilled" : "CupEmpty")
                    .resizable()
                    .scaledToFit()
                    .frame(width: size, height: size * 4 / 3)
            }
        }
        .environment(\.layoutDirection, .leftToRight)
    }
}

/// Order number and a step bar, for when an order is in progress.
struct OrderStrip: View {
    let order: HollowWidgetState.Order
    let arabic: Bool

    var body: some View {
        let flow = HollowText.flow(order.fulfillment)
        let step = flow.firstIndex(of: order.status) ?? 0
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(arabic ? "طلبك" : "Order").font(.caption2.weight(.semibold)).foregroundColor(Palette.soft)
                Text("#\(order.number)").font(.caption.weight(.heavy)).foregroundColor(Palette.ink)
                    .environment(\.layoutDirection, .leftToRight)
            }
            Text(HollowText.status(order.status, fulfillment: order.fulfillment, arabic: arabic))
                .font(.caption.weight(.bold))
                .foregroundColor(Palette.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            HStack(spacing: 3) {
                ForEach(0..<flow.count, id: \.self) { i in
                    Capsule().fill(i <= step ? Palette.gold : Palette.soft.opacity(0.25)).frame(height: 4)
                }
            }
        }
    }
}

struct SignedOut: View {
    let arabic: Bool

    var body: some View {
        VStack(spacing: 6) {
            Image("Wordmark").resizable().scaledToFit().frame(height: 14)
            Text(arabic ? "سجّل دخولك في تطبيق HOLLOW لتظهر بطاقتك هنا" : "Sign in to the HOLLOW app to see your card here")
                .font(.caption2)
                .multilineTextAlignment(.center)
                .foregroundColor(Palette.soft)
        }
    }
}

// MARK: - Sizes

struct CardWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CardEntry

    private var arabic: Bool { entry.state?.isArabic ?? deviceIsArabic }

    var body: some View {
        content
            .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
            .widgetURL(link)
    }

    private var link: URL? {
        if let order = entry.state?.order { return URL(string: "hollowcoffee://orders/\(order.id)") }
        return URL(string: "hollowcoffee://wallet")
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .accessoryInline: inline
        case .systemMedium: medium
        default: small
        }
    }

    private var cupsText: String {
        guard let card = entry.state?.card else { return "" }
        if card.reward { return arabic ? "مشروبك المجاني جاهز" : "Free drink ready" }
        return arabic ? "\(card.stamps) من \(card.max) أكواب" : "\(card.stamps) of \(card.max) cups"
    }

    // Home screen, small: the order if one is in progress, else the cups.
    private var small: some View {
        Group {
            if let card = entry.state?.card {
                VStack(alignment: .leading, spacing: 8) {
                    Image("Wordmark").resizable().scaledToFit().frame(height: 12)
                    Spacer(minLength: 0)
                    if let order = entry.state?.order {
                        OrderStrip(order: order, arabic: arabic)
                    } else {
                        Text(card.reward ? "🎁" : "\(card.stamps)/\(card.max)")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundColor(card.reward ? Palette.gold : Palette.ink)
                            .environment(\.layoutDirection, .leftToRight)
                        CupRow(stamps: card.stamps, max: card.max, size: 17)
                        Text(cupsText).font(.caption2.weight(.semibold)).foregroundColor(Palette.soft).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                SignedOut(arabic: arabic)
            }
        }
        .widgetBackground(Palette.background)
    }

    // Home screen, medium: the card and the QR to scan at the counter.
    private var medium: some View {
        Group {
            if let card = entry.state?.card {
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image("Wordmark").resizable().scaledToFit().frame(height: 13)
                        Text(card.name).font(.subheadline.weight(.bold)).foregroundColor(Palette.ink).lineLimit(1)
                        Spacer(minLength: 0)
                        if let order = entry.state?.order {
                            OrderStrip(order: order, arabic: arabic)
                        } else {
                            CupRow(stamps: card.stamps, max: card.max, size: 19)
                            Text(cupsText).font(.caption.weight(.semibold)).foregroundColor(card.reward ? Palette.gold : Palette.soft).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    if card.active {
                        QRImage(payload: card.qr)
                            .padding(7)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                            .frame(maxHeight: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                            .accessibilityLabel(arabic ? "رمز البطاقة" : "Card code")
                    }
                }
            } else {
                SignedOut(arabic: arabic)
            }
        }
        .widgetBackground(Palette.background)
    }

    // Lock screen.
    private var circular: some View {
        Group {
            if let card = entry.state?.card {
                if let order = entry.state?.order {
                    let flow = HollowText.flow(order.fulfillment)
                    Gauge(value: Double((flow.firstIndex(of: order.status) ?? 0) + 1), in: 0...Double(flow.count)) {
                        Image(systemName: "cup.and.saucer.fill")
                    } currentValueLabel: {
                        Text("#\(order.number)").font(.caption2.weight(.bold))
                    }
                    .gaugeStyle(.accessoryCircular)
                } else {
                    Gauge(value: Double(card.stamps), in: 0...Double(card.max)) {
                        Image(systemName: "cup.and.saucer.fill")
                    } currentValueLabel: {
                        Text(card.reward ? "🎁" : "\(card.stamps)")
                    }
                    .gaugeStyle(.accessoryCircular)
                }
            } else {
                Image(systemName: "cup.and.saucer.fill")
            }
        }
        .widgetBackground(.clear)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("HOLLOW").font(.headline.weight(.heavy))
            if let order = entry.state?.order {
                Text("#\(order.number) · " + HollowText.status(order.status, fulfillment: order.fulfillment, arabic: arabic))
                    .font(.caption).lineLimit(2)
            } else if entry.state?.card != nil {
                Text(cupsText).font(.caption)
            } else {
                Text(arabic ? "سجّل دخولك في التطبيق" : "Sign in to the app").font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetBackground(.clear)
    }

    private var inline: some View {
        Group {
            if let order = entry.state?.order {
                Text("☕ #\(order.number) " + HollowText.status(order.status, fulfillment: order.fulfillment, arabic: arabic))
            } else if entry.state?.card != nil {
                Text("☕ HOLLOW · " + cupsText)
            } else {
                Text("☕ HOLLOW")
            }
        }
        .widgetBackground(.clear)
    }
}

struct CardWidget: Widget {
    let kind = "HollowCard"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CardProvider()) { entry in
            CardWidgetView(entry: entry)
        }
        .configurationDisplayName("HOLLOW")
        .description(Text(deviceIsArabic ? "أكوابك، طلبك الحالي، ورمز بطاقتك." : "Your cups, your current order and your card code."))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
