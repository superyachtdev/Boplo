import SwiftUI
import StoreKit

/// Shown once on the desk to a monthly subscriber after their second paid month: what they've paid so far,
/// and what switching to yearly saves. Dismissing it hides it for good.
struct YearlyUpgradeCard: View {
    @Environment(StoreModel.self) private var store
    @AppStorage("boplo.yearlyPrompt.dismissed") private var dismissed = false

    var body: some View {
        if !dismissed, store.monthlyPayments >= 2, let m = store.monthly, let y = store.yearly {
            let paid = m.price * Decimal(store.monthlyPayments)
            let saving = savingPercent(monthly: m.price, yearly: y.price)
            Tile(spacing: 12) {
                HStack(alignment: .top) {
                    Text("Save \(saving)% with yearly").font(.archivo(19, .semibold))
                    Spacer()
                    Button { withAnimation(.snappy) { dismissed = true } } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.ink3)
                            .frame(width: 30, height: 30)
                    }
                    .accessibilityLabel("Not now")
                }
                Text("You’ve paid \(paid.formatted(m.priceFormatStyle)) over \(store.monthlyPayments) months. Yearly is \(y.displayPrice), about \((y.price / 12).formatted(y.priceFormatStyle)) a month, and it covers the rest of your training without monthly charges.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                Button { Task { await store.buy(y); if store.monthlyPayments == 0 { dismissed = true } } } label: {
                    Text("Switch to yearly")
                }
                .buttonStyle(.pill(.blue, height: 46, full: true))
                .disabled(store.busy)
                Text("The App Store switches your plan and credits any unused time. Manage it any time in Settings → Subscriptions.")
                    .font(.archivo(12)).foregroundStyle(Theme.ink3)
            }
            .transition(.opacity)
        }
    }

    private func savingPercent(monthly: Decimal, yearly: Decimal) -> Int {
        let twelve = NSDecimalNumber(decimal: monthly * 12).doubleValue, y = NSDecimalNumber(decimal: yearly).doubleValue
        guard twelve > 0 else { return 0 }
        return max(0, Int(((1 - y / twelve) * 100).rounded()))
    }
}
