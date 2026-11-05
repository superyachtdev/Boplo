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

    var yearly: Product? { products.first { $0.id == Self.yearlyID } }
    var monthly: Product? { products.first { $0.id == Self.monthlyID } }

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
    }

    func loadProducts() async {
        do {
            products = try await Product.products(for: [Self.yearlyID, Self.monthlyID])
                .sorted { $0.id == Self.yearlyID && $1.id != Self.yearlyID }
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
            if case .verified(let t) = result, [Self.yearlyID, Self.monthlyID].contains(t.productID) {
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
