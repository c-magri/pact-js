const path = require("path")
const chai = require("chai")
const chaiAsPromised = require("chai-as-promised")
const expect = chai.expect
const { Pact, Matchers } = require("@pact-foundation/pact")
const LOG_LEVEL = process.env.LOG_LEVEL || "WARN"

chai.use(chaiAsPromised)

describe("Pact", () => {
  const provider = new Pact({
    consumer: "Matching Service",
    provider: "Animal Profile Service",
    // port: 1234, // You can set the port explicitly here or dynamically (see setup() below)
    log: path.resolve(process.cwd(), "logs", "mockserver-integration.log"),
    dir: path.resolve(process.cwd(), "pacts"),
    logLevel: LOG_LEVEL,
    spec: 2,
  })

  // Alias flexible matchers for simplicity
  const { eachLike, like, term, iso8601DateTimeWithMillis } = Matchers

  // Animal we want to match :)
  const suitor = {
    id: 2,
    available_from: "2017-12-04T14:47:18.582Z",
    first_name: "Nanny",
    animal: "goat",
    last_name: "Doe",
    age: 27,
    gender: "F",
    location: {
      description: "Werribee Zoo",
      country: "Australia",
      post_code: 3000,
    },
    eligibility: {
      available: true,
      previously_married: true,
    },
    interests: ["walks in the garden/meadow", "parkour"],
  }

  const MIN_ANIMALS = 2

  // Define animal payload, with flexible matchers
  //
  // This makes the test much more resilient to changes in actual data.
  // Here we specify the 'shape' of the object that we care about.
  // It is also import here to not put in expectations for parts of the
  // API we don't care about
  const animalBodyExpectation = {
    id: like(1),
    available_from: iso8601DateTimeWithMillis(),
    first_name: like("Billy"),
    last_name: like("Goat"),
    animal: like("goat"),
    age: like(21),
    gender: term({
      matcher: "F|M",
      generate: "M",
    }),
    location: {
      description: like("Melbourne Zoo"),
      country: like("Australia"),
      post_code: like(3000),
    },
    eligibility: {
      available: like(true),
      previously_married: like(false),
    },
    interests: eachLike("walks in the garden/meadow"),
  }

  // Define animal list payload, reusing existing object matcher
  const animalListExpectation = eachLike(animalBodyExpectation, {
    min: MIN_ANIMALS,
  })

  // Setup a Mock Server before unit tests run.
  // This server acts as a Test Double for the real Provider API.
  // We then call addInteraction() for each test to configure the Mock Service
  // to act like the Provider
  // It also sets up expectations for what requests are to come, and will fail
  // if the calls are not seen.
  before(() =>
    provider.setup().then(opts => {
      // Get a dynamic port from the runtime
      process.env.API_HOST = `http://localhost:${opts.port}`
    })
  )

  // After each individual test (one or more interactions)
  // we validate that the correct request came through.
  // This ensures what we _expect_ from the provider, is actually
  // what we've asked for (and is what gets captured in the contract)
  afterEach(() => provider.verify())

  // Configure and import consumer API
  // Note that we update the API endpoint to point at the Mock Service
  const {
    createMateForDates,
    suggestion,
    getAnimalById,
  } = require("../consumer")

  describe("when a call to the Animal Service is made to create a new mate ANIMAL STATE", () => {
    before(() =>
      provider.addInteraction({
        state: "animal state",
        uponReceiving: "a request to create a new mate",
        withRequest: {
          method: "POST",
          path: "/animals",
          body: like(suitor),
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: like(suitor),
        },
      })
    )

    it("creates a new mate", done => {
      expect(createMateForDates(suitor)).to.eventually.be.fulfilled.notify(done)
    })
  })

  // Write pact files
  after(() => {
    return provider.finalize()
  })
})
