import Foundation
import StoreKit
import Observation

/// Advanced through the App Store. Each purchase's signed transaction is sent to Boplo's server,
/// which checks it with Apple and ties it to the signed-in account (POST /flight/billing/apple).
@MainActor
@Observable
final class StoreModel {
    static let yearlyID = "app.boplo.flight.advanced.yearly"
    static let monthlyID = "app.boplo.flight.advanced.monthly"

    private(set) var products: [Product] = []
    private(set) var busy = false
    var message: String?

    private weak var model: AppModel?
    private var updates: Task<Void, Never>?

    /// The App Store Connect record uses the short IDs; the long ones are kept so either set works.
    static let yearlyIDs = [yearlyID, "advancedyearly"]
    static let monthlyIDs = [monthlyID, "advancedmonthly"]
    var yearly: Product? { products.first { Self.yearlyIDs.contains($0.id) } }
    var monthly: Product? { products.first { Self.monthlyIDs.contains($0.id) } }

    /// A win-back offer (set up in App Store Connect) this Apple ID can redeem after letting Advanced lapse. iOS 18+.
    private(set) var winBack: WinBack?
    struct WinBack {
        let product: Product
        let offer: Product.SubscriptionOffer
        /// "€49.99 for your first year", "50% off for 3 months" style line for the offer card.
        var line: String {
            let unit: String
            switch offer.period.unit { case .day: unit = "day"; case .week: unit = "week"; case .month: unit = "month"; case .year: unit = "year"; @unknown default: unit = "period" }
            let n = offer.period.value * max(1, offer.periodCount)
            let span = n == 1 ? "your first \(unit)" : "your first \(n) \(unit)s"
            switch offer.paymentMode {
            case .freeTrial: return "\(n == 1 ? "1 \(unit)" : "\(n) \(unit)s") free, then \(product.displayPrice)"
            case .payUpFront: return "\(offer.displayPrice) for \(span)"
            default: return "\(offer.displayPrice) a \(offer.period.unit == .year ? "year" : "month") for \(span)"
            }
        }
    }

    func start(model: AppModel) async {
        self.model = model
        updates?.cancel()
        // Renewals and purchases approved later (Ask to Buy) arrive here.
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.handle(result)
            }
        }
        await loadProducts()
        await loadWinBack()
        await loadMonthlyPayments()
    }

    /// Paid monthly renewals on the current monthly subscription (the free trial doesn't count); 0 when on yearly or none.
    private(set) var monthlyPayments = 0

    func loadMonthlyPayments() async {
        var current: Transaction?
        for await r in Transaction.currentEntitlements {
            if case .verified(let t) = r, Self.monthlyIDs.contains(t.productID), t.revocationDate == nil { current = t }
        }
        guard let current else { monthlyPayments = 0; return }
        var n = 0
        for await r in Transaction.all {
            if case .verified(let t) = r, t.originalID == current.originalID, Self.monthlyIDs.contains(t.productID),
               t.revocationDate == nil, t.offerType != .introductory { n += 1 }
        }
        monthlyPayments = n
    }

    /// Looks for a win-back offer Apple says this Apple ID is eligible for (only after a subscription has lapsed).
    func loadWinBack() async {
        winBack = nil
        guard #available(iOS 18.0, *) else { return }
        for product in products {
            guard let sub = product.subscription, let statuses = try? await sub.status else { continue }
            let eligible = Set(statuses.flatMap { st -> [String] in
                if case .verified(let renewal) = st.renewalInfo { return renewal.eligibleWinBackOfferIDs }
                return []
            })
            if let offer = sub.winBackOffers.first(where: { eligible.contains($0.id ?? "") }) {
                winBack = WinBack(product: product, offer: offer)
                return
            }
        }
    }

    /// Redeems the win-back offer: the same purchase flow, with the offer applied by the App Store.
    func buyWinBack() async {
        guard let wb = winBack else { return }
        guard #available(iOS 18.0, *) else { await buy(wb.product); return }
        busy = true; message = nil
        defer { busy = false }
        do {
            switch try await wb.product.purchase(options: [.winBackOffer(wb.offer)]) {
            case .success(let verification): await handle(verification); winBack = nil
            case .pending: message = "Your purchase is waiting for approval."
            default: break
            }
        } catch {
            message = "The App Store couldn’t complete that purchase. Try again."
        }
    }

    func loadProducts() async {
        do {
            products = try await Product.products(for: Self.yearlyIDs + Self.monthlyIDs)
                .sorted { Self.yearlyIDs.contains($0.id) && !Self.yearlyIDs.contains($1.id) }
        } catch {
            products = []
        }
    }

    func buy(_ product: Product) async {
        busy = true; message = nil
        defer { busy = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                await handle(verification)
            case .pending:
                message = "Your purchase is waiting for approval."
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            message = "The App Store couldn’t complete that purchase. Try again."
        }
    }

    func restore() async {
        busy = true; message = nil
        defer { busy = false }
        try? await AppStore.sync()
        var signed: [String] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, (Self.yearlyIDs + Self.monthlyIDs).contains(t.productID) {
                signed.append(result.jwsRepresentation)
            }
        }
        if signed.isEmpty {
            message = "No App Store subscription was found for this Apple ID."
            return
        }
        await claim(signed)
        if model?.isAdvanced == true { message = "Advanced restored." }
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else {
            message = "The App Store couldn’t verify that purchase."
            return
        }
        await claim([result.jwsRepresentation])
        await transaction.finish()
        await loadMonthlyPayments()
    }

    private func claim(_ signedTransactions: [String]) async {
        do {
            try await API.shared.send("flight/billing/apple", method: "POST", body: ["signedTransactions": signedTransactions])
            await model?.refresh()
        } catch {
            message = error.localizedDescription
        }
    }
}
