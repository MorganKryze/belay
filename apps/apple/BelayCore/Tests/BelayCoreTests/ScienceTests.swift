import Testing

@testable import BelayCore

// « Comment c'est calculé » reads the shared science catalogue, generated into the package.
@Suite struct ScienceTests {
  @Test func theLossRangeReadsInBothLanguages() throws {
    let fr = try #require(Science.entry("target-rate", language: "fr"))
    #expect(fr.title == "Fourchette de perte")
    #expect(fr.formula.count == 2)
    #expect(fr.limits.last == "Ces deux sources portent sur des athlètes entraînés.")
    #expect(fr.sources.map(\.cite) == ["Helms et al. 2014", "Garthe et al. 2011"])
    #expect(fr.sources.first?.links.first?.url?.hasPrefix("https://doi.org/") == true)
    let en = try #require(Science.entry("target-rate", language: "en-GB"))
    #expect(en.title == "Loss range")
  }

  @Test func anUnknownEntryIsNil() {
    #expect(Science.entry("nothing", language: "fr") == nil)
  }
}
