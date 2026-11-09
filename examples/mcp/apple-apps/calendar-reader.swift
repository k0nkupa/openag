import Foundation
import EventKit

func output(_ value: Any) {
    do { let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(decoding: data, as: UTF8.self)) }
    catch { print("{\"error\":\"calendar_encoding_failed\"}"); exit(1) }
}
func fail(_ code: String) -> Never { output(["error": code]); exit(1) }
let args = Array(CommandLine.arguments.dropFirst())
guard let action = args.first, ["status", "permission", "events", "calendars", "reminders-status", "reminders-permission", "reminders-lists", "reminders", "search-reminders"].contains(action) else { fail("invalid_calendar_request") }
if action == "events" {
    guard args.count == 3, let count = Int(args[1]), (1...50).contains(count), let days = Int(args[2]), (1...365).contains(days) else { fail("invalid_calendar_request") }
} else if action == "reminders" || action == "search-reminders" {
    guard (3...4).contains(args.count), let count = Int(args[1]), (1...50).contains(count), args.dropFirst(2).allSatisfy({ !$0.isEmpty && $0.count <= 500 && $0.rangeOfCharacter(from: .controlCharacters) == nil }) else { fail("invalid_calendar_request") }
    guard action == "reminders" ? ["true", "false"].contains(args[2]) : args.count == 3 else { fail("invalid_calendar_request") }
} else if args.count != 1 { fail("invalid_calendar_request") }
let reminderAction = action.hasPrefix("reminders") || action == "search-reminders"
let authorized = { EKEventStore.authorizationStatus(for: reminderAction ? .reminder : .event) == .fullAccess }
if action == "status" || action == "reminders-status" { output(["authorized": authorized()]); exit(0) }
let store = EKEventStore()
if action == "permission" || action == "reminders-permission" {
    var completed = true
    if !authorized() {
        let done = DispatchGroup(); done.enter()
        if reminderAction { store.requestFullAccessToReminders { _, _ in done.leave() } }
        else { store.requestFullAccessToEvents { _, _ in done.leave() } }
        let deadline = Date().addingTimeInterval(110)
        while done.wait(timeout: .now()) != .success && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
        completed = done.wait(timeout: .now()) == .success
    }
    output(["permission": authorized() ? "granted" : completed ? "denied" : "failed"]); exit(0)
}
if action == "reminders-lists" {
    guard authorized() else { fail("reminders_full_access_required") }
    output(store.calendars(for: .reminder).map { ["id": $0.calendarIdentifier, "name": $0.title] }); exit(0)
}
if action == "reminders" || action == "search-reminders" {
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { fail("reminders_full_access_required") }
    let count = Int(args[1])!, search = action == "search-reminders"
    let calendars = store.calendars(for: .reminder).filter { search || args.count == 3 || $0.title == args[3] }
    if calendars.isEmpty { output([]); exit(0) }
    let predicate = !search && args[2] == "false"
        ? store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        : store.predicateForReminders(in: calendars)
    var rows: [EKReminder]?
    let done = DispatchGroup(); done.enter()
    let fetch = store.fetchReminders(matching: predicate) { rows = $0; done.leave() }
    let deadline = Date().addingTimeInterval(15)
    while done.wait(timeout: .now()) != .success && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
    guard done.wait(timeout: .now()) == .success, var reminders = rows else { store.cancelFetchRequest(fetch); fail("reminders_read_failed") }
    func due(_ item: EKReminder) -> Date? { item.dueDateComponents.flatMap { Calendar.current.date(from: $0) } }
    if search {
        let query = args[2].lowercased()
        reminders = reminders.filter { (($0.title ?? "") + "\n" + ($0.notes ?? "")).lowercased().contains(query) }
    } else {
        reminders = reminders.enumerated().sorted {
            let a = due($0.element) ?? .distantFuture, b = due($1.element) ?? .distantFuture
            return a == b ? $0.offset < $1.offset : a < b
        }.map { $0.element }
    }
    let format = ISO8601DateFormatter()
    output(reminders.prefix(count).map { r in ["id": r.calendarItemIdentifier, "name": r.title ?? "", "body": r.notes ?? "", "completed": r.isCompleted, "dueDate": due(r).map { format.string(from: $0) } as Any? ?? NSNull(), "priority": r.priority, "list": r.calendar.title] as [String: Any] }); exit(0)
}
guard authorized() else { fail("calendar_full_access_required") }
if action == "calendars" {
    output(store.calendars(for: .event).map { ["id": $0.calendarIdentifier, "name": $0.title, "writable": $0.allowsContentModifications] as [String: Any] }); exit(0)
}
let count = Int(args[1])!, days = Int(args[2])!, start = Date(), end = start.addingTimeInterval(Double(days) * 86400)
let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
let events = store.events(matching: predicate).filter { $0.startDate >= start && $0.startDate < end }.sorted { $0.startDate < $1.startDate }.prefix(count)
let format = ISO8601DateFormatter()
output(events.map { e in ["id": e.eventIdentifier ?? e.calendarItemIdentifier, "summary": e.title ?? "", "startDate": format.string(from: e.startDate), "endDate": format.string(from: e.endDate), "location": e.location ?? "", "calendar": e.calendar.title] as [String: Any] })
