import SwiftUI

struct LogbookView: View {
    @Environment(AppModel.self) private var model
    @State private var showLog = false
    @State private var search = ""

    private var filtered: [Flight] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return model.flights }
        return model.flights.filter {
            [$0.departure, $0.arrival, $0.aircraft, $0.registration, $0.lesson, $0.instructor, $0.notes]
                .compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
    }

    /// Flights grouped by month, newest first.
    private var months: [(String, [Flight])] {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; f.timeZone = TimeZone(identifier: "UTC")
        var order: [String] = [], groups: [String: [Flight]] = [:]
        for flight in filtered {
            let key = flight.day.map { f.string(from: $0) } ?? "Undated"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(flight)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        total("Total", hoursText(model.totalMinutes))
                        total("Flights", "\(model.flights.count)")
                        total("Landings", "\(model.landings)")
                    }
                    .listRowBackground(Color.clear)
                }
                if model.flights.isEmpty {
                    ContentUnavailableView {
                        Label("No flights yet", systemImage: "airplane.departure")
                    } description: {
                        Text("Log your first flight and it shows up here, with your totals.")
                    } actions: {
                        Button("Log a flight") { showLog = true }.buttonStyle(.borderedProminent)
                    }
                }
                ForEach(months, id: \.0) { month, flights in
                    Section(month) {
                        ForEach(flights) { flight in
                            NavigationLink(value: flight) { FlightRow(flight: flight) }
                        }
                    }
                }
                if !model.isAdvanced, model.flights.count >= 12 {
                    Section {
                        Text("The Free plan holds 15 flights. Advanced keeps an unlimited logbook.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Logbook")
            .searchable(text: $search, prompt: "Airfield, aircraft, lesson")
            .refreshable { await model.refresh() }
            .navigationDestination(for: Flight.self) { FlightDetailView(flight: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showLog = true } label: { Label("Log a flight", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showLog) { FlightFormView() }
        }
    }

    private func total(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.bold().italic()).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct FlightRow: View {
    let flight: Flight

    private static let short: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "d MMM"; f.timeZone = TimeZone(identifier: "UTC"); return f
    }()

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(flight.route).font(.body.weight(.semibold))
                Text([flight.day.map { FlightRow.short.string(from: $0) }, flight.lesson, flight.aircraft]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(hoursText(flight.mins)).font(.body.weight(.semibold)).monospacedDigit()
                Text(flight.roleLabel)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Theme.electric.opacity(0.12), in: Capsule())
                    .foregroundStyle(Theme.electric)
            }
        }
        .padding(.vertical, 2)
    }
}
