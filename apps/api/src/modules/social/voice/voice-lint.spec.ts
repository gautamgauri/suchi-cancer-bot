import { lintProse, lintSocial, lintVoice, xWeightedLength, firstSentence } from "./voice-lint";

const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("lintProse (port of the owner's prose linter)", () => {
  it("passes plain prose", () => {
    expect(lintProse("Write the questions down. Bring someone who can take notes.")).toEqual([]);
  });

  it.each([
    ["em dash", "Write it down — then go."],
    ["en dash", "From 2015 – 2016."],
  ])("flags an %s", (_l, text) => {
    expect(codes(lintProse(text))).toContain("dash");
  });

  it("flags a semicolon", () => {
    expect(codes(lintProse("Write it down; then go."))).toContain("semicolon");
  });

  it("flags a colon after four or more words and allows a short label", () => {
    expect(codes(lintProse("The thing you need most is this: a list."))).toContain("colon_reveal");
    expect(lintProse("Source: the Press Information Bureau.")).toEqual([]);
  });

  it.each([
    "deliberately", "genuinely", "meaningful", "precisely", "fundamentally", "journey",
    "at the intersection of", "goes beyond", "worth noting", "not only", "not just", "rather than",
  ])("flags the banned phrase %s", (w) => {
    expect(codes(lintProse(`This is ${w} something.`))).toContain("banned_phrase");
  });

  it("flags the cancer journey", () => {
    expect(codes(lintProse("Every cancer journey is different."))).toContain("banned_phrase");
  });

  it.each([
    "Suchi is a guide, not a doctor.",
    "It is not a hospital. It is a guide.",
    "More care, or less.",
  ])("flags antithesis: %s", (t) => {
    expect(codes(lintProse(t))).toContain("antithesis");
  });

  it("ignores URLs, inline code and times, as the Python linter does", () => {
    expect(lintProse("See https://example.org/a;b and `a; b` at 10:30.")).toEqual([]);
  });

  it("skips text between prose-lint off and on markers", () => {
    expect(lintProse("<!-- prose-lint: off -->\nA; B\n<!-- prose-lint: on -->\nPlain.")).toEqual([]);
  });
});

describe("lintSocial", () => {
  const ok = "Write the questions down before the visit. Bring someone who can take notes.\nhttps://chat.suchitracancercare.org/?src=social-x";

  it("passes a plain post", () => {
    expect(lintSocial("x", ok)).toEqual([]);
  });

  it("counts a URL as 23 characters on X", () => {
    expect(xWeightedLength(`abc https://example.org/${"a".repeat(200)}`)).toBe(4 + 23);
    expect(codes(lintSocial("x", "a".repeat(281)))).toContain("too_long");
    expect(codes(lintSocial("x", `${"a".repeat(250)} https://example.org/${"b".repeat(100)}`))).not.toContain("too_long");
  });

  it("allows no emoji on LinkedIn and one elsewhere", () => {
    expect(codes(lintSocial("linkedin", "A calm post \u{1F49A}."))).toContain("emoji");
    expect(codes(lintSocial("facebook", "A calm post \u{1F49A}."))).not.toContain("emoji");
    expect(codes(lintSocial("facebook", "A calm post \u{1F49A}\u{1F64F}."))).toContain("emoji");
  });

  it("limits hashtags, keeps them on the last line, and allows none on X or LinkedIn", () => {
    expect(codes(lintSocial("instagram", "Text.\n#One #Two #Three", "Card."))).toContain("hashtags");
    expect(codes(lintSocial("instagram", "Text #One.\nMore.", "Card."))).toContain("hashtag_position");
    expect(codes(lintSocial("x", "Text.\n#One"))).toContain("hashtags");
    expect(codes(lintSocial("linkedin", "Text.\n#One"))).toContain("hashtags");
    expect(codes(lintSocial("instagram", "Text.\n#One #Two", "Card."))).toEqual([]);
  });

  it.each([
    ["exclamation", "Book your visit today!"],
    ["question_opener", "Worried about costs? Here is help."],
    ["cliche", "Did you know that PM-JAY exists."],
    ["cliche", "Here's what you need to know about PM-JAY."],
    ["engagement_bait", "Tag a friend who should read this."],
    ["engagement_bait", "Share this with your family."],
    ["fear", "Cancer is a silent killer."],
    ["promise", "This treatment will cure it."],
    ["promise", "Results are guaranteed."],
    ["war_language", "She is a brave fighter."],
    ["war_language", "Every survivor has a story."],
    ["reader_has_cancer", "Your cancer can be managed."],
    ["reader_has_cancer", "If you have cancer, call us."],
    ["marketing", "We empower families."],
    ["marketing", "A holistic, seamless service."],
    ["listicle", "Three things.\n• one\n• two"],
    ["listicle", "Steps.\n1. Call\n2. Write"],
    ["listicle", "Steps.\n- Call"],
  ])("flags %s: %s", (code, text) => {
    expect(codes(lintSocial("facebook", text))).toContain(code);
  });

  it("allows war words inside a quotation", () => {
    expect(codes(lintSocial("facebook", 'The film is called "The Fight".'))).not.toContain("war_language");
  });

  it("asks Instagram for card text and checks it", () => {
    expect(codes(lintSocial("instagram", "Caption."))).toContain("card_missing");
    expect(codes(lintSocial("instagram", "Caption.", "Card text; with a semicolon."))).toContain("card_semicolon");
    expect(codes(lintSocial("instagram", "Caption.", "A".repeat(121)))).toContain("card_too_long");
    expect(codes(lintSocial("instagram", "Caption.", "Worried? Read this."))).toContain("card_question_opener");
  });

  it("finds the first sentence without counting a URL", () => {
    expect(firstSentence("https://a.org/?x=1 Hello there. Next?")).toBe("Hello there.");
  });

  it("lintVoice combines both parts", () => {
    expect(codes(lintVoice("facebook", "Your cancer journey; we help!"))).toEqual(
      expect.arrayContaining(["semicolon", "banned_phrase", "exclamation", "reader_has_cancer"]),
    );
  });
});
