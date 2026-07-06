import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import * as fs from "node:fs/promises";
import { NavigatorApproveService } from "./navigator-approve.service";

jest.mock("node:fs/promises");

const mockFs = fs as jest.Mocked<typeof fs>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = "suchi-nav-dev-secret";

function makeToken(batchId: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(batchId).digest("hex");
}

const BATCH_ID = "gov-01";

const minimalDraft = {
  id: "hosp-001",
  name: "Test Cancer Centre",
  short_name: "TCC",
  city: "Patna",
  state: "Bihar",
  region: "East India",
  type: "Government",
  accreditation: ["NABH"],
  ncg_member: false,
  departments: ["Oncology"],
  cost_tier: "Low",
  pmjay_empanelled: true,
  contact: { phone: "0612-000000", address: "MG Road, Patna", website: null },
  key_doctors: [],
  notes: "",
  tier: "B" as const,
  navigation_notes: [],
  score: 7,
  verified_date: "2026-05-01",
  status: "draft" as const,
  confidence: "high" as const,
  sources: [],
};

function makeQueue(status: string, batchId = BATCH_ID) {
  return JSON.stringify({
    batches: [
      {
        id: batchId,
        region: "East India",
        status,
        hospitals: [minimalDraft],
        createdAt: "2026-05-01T00:00:00.000Z",
        emailSentAt: "2026-05-02T00:00:00.000Z",
        approvalToken: makeToken(batchId),
      },
    ],
  });
}

function makeHospitals() {
  return JSON.stringify({
    _meta: { total_hospitals: 0, last_updated: "2026-01-01" },
    hospitals: [],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupLocalMocks(queueStatus = "email_sent") {
  // access() succeeds for the first candidate path (queue) and for hospitals
  mockFs.access.mockResolvedValue(undefined);

  mockFs.readFile.mockImplementation((filePath, _encoding) => {
    const p = filePath as string;
    if (p.includes("queue")) return Promise.resolve(makeQueue(queueStatus));
    return Promise.resolve(makeHospitals());
  });

  mockFs.writeFile.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NavigatorApproveService", () => {
  let service: NavigatorApproveService;

  beforeEach(() => {
    // Ensure local-mode (no GCS bucket)
    delete process.env.QUEUE_GCS_BUCKET;
    delete process.env.NAVIGATOR_APPROVAL_SECRET;

    jest.clearAllMocks();
    service = new NavigatorApproveService();
  });

  it("approves a batch and appends hospitals when token is valid", async () => {
    setupLocalMocks("email_sent");

    const result = await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    expect(result.approved).toBe(true);
    expect(result.batchId).toBe(BATCH_ID);
    expect(result.hospitalsAdded).toBe(1);
    expect(result.hospitalNames).toEqual([minimalDraft.name]);
    expect(result.error).toBeUndefined();
  });

  it("writes updated hospitals.json with the new entry appended", async () => {
    setupLocalMocks("email_sent");

    await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    const writeCalls = mockFs.writeFile.mock.calls;
    const hospitalsWrite = writeCalls.find((c) =>
      (c[0] as string).includes("hospitals")
    );
    expect(hospitalsWrite).toBeDefined();
    const written = JSON.parse(hospitalsWrite![1] as string);
    expect(written.hospitals).toHaveLength(1);
    expect(written.hospitals[0].name).toBe(minimalDraft.name);
    expect(written._meta.total_hospitals).toBe(1);
  });

  it("marks the batch as approved in the written queue.json", async () => {
    setupLocalMocks("email_sent");

    await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    const writeCalls = mockFs.writeFile.mock.calls;
    const queueWrite = writeCalls.find((c) =>
      (c[0] as string).includes("queue")
    );
    expect(queueWrite).toBeDefined();
    const written = JSON.parse(queueWrite![1] as string);
    const batch = written.batches.find((b: { id: string }) => b.id === BATCH_ID);
    expect(batch.status).toBe("approved");
    expect(batch.approvedBy).toBe("portal_approval");
    expect(batch.approvedAt).toBeDefined();
  });

  it("throws UnauthorizedException when the token is wrong", async () => {
    setupLocalMocks("email_sent");
    const badToken = makeToken(BATCH_ID, "wrong-secret");

    await expect(
      service.approveNavigatorBatch(BATCH_ID, badToken),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when the token is an empty string", async () => {
    setupLocalMocks("email_sent");

    await expect(
      service.approveNavigatorBatch(BATCH_ID, ""),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when the token is a random string of wrong length", async () => {
    setupLocalMocks("email_sent");

    await expect(
      service.approveNavigatorBatch(BATCH_ID, "deadbeef"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("returns { error: 'Already approved' } without touching files when batch is already approved", async () => {
    setupLocalMocks("approved");

    const result = await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    expect(result.approved).toBe(true);
    expect(result.hospitalsAdded).toBe(0);
    expect(result.hospitalNames).toEqual([]);
    expect(result.error).toBe("Already approved");
    // hospitals.json must not have been written
    const hospitalsWrite = mockFs.writeFile.mock.calls.find((c) =>
      (c[0] as string).includes("hospitals")
    );
    expect(hospitalsWrite).toBeUndefined();
  });

  it("throws NotFoundException when the batchId does not exist in the queue", async () => {
    setupLocalMocks("email_sent");

    await expect(
      service.approveNavigatorBatch("nonexistent-batch", makeToken("nonexistent-batch")),
    ).rejects.toThrow(NotFoundException);
  });

  it("uses NAVIGATOR_APPROVAL_SECRET from env when set", async () => {
    process.env.NAVIGATOR_APPROVAL_SECRET = "custom-secret-xyz";
    setupLocalMocks("email_sent");

    // Token signed with the custom secret must succeed
    const token = makeToken(BATCH_ID, "custom-secret-xyz");
    const result = await service.approveNavigatorBatch(BATCH_ID, token);
    expect(result.approved).toBe(true);

    // Token signed with the default secret must fail
    await expect(
      service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID, SECRET)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("converts the draft correctly — sets status to active and fills defaults", async () => {
    setupLocalMocks("email_sent");

    await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    const writeCalls = mockFs.writeFile.mock.calls;
    const hospitalsWrite = writeCalls.find((c) =>
      (c[0] as string).includes("hospitals")
    );
    const written = JSON.parse(hospitalsWrite![1] as string);
    const entry = written.hospitals[0];

    expect(entry.status).toBe("active");
    expect(entry.referral_required).toBe(false);
    expect(entry.sccf_affiliated).toBe(false);
    expect(entry.cost_ranges).toBeDefined();
    expect(entry.logistics).toBeDefined();
    expect(entry.trust_signals).toBeDefined();
    expect(entry.score).toBe(minimalDraft.score);
    expect(entry.tier).toBe(minimalDraft.tier);
  });

  it("deduplicates hospitals based on clean name, city, state, or phone", async () => {
    mockFs.access.mockResolvedValue(undefined);

    // Mock existing hospitals: has one hospital with same name/city/state
    // and another with same phone.
    const existingHospitals = {
      _meta: { total_hospitals: 2, last_updated: "2026-01-01" },
      hospitals: [
        {
          id: "existing-001",
          name: "Test Cancer Centre", // same clean name
          city: "Patna",
          state: "Bihar",
          contact: { phone: "000" }
        },
        {
          id: "existing-002",
          name: "Other Hospital",
          city: "Ranchi",
          state: "Jharkhand",
          contact: { phone: "0612-000000" } // same clean phone
        }
      ],
    };

    mockFs.readFile.mockImplementation((filePath, _encoding) => {
      const p = filePath as string;
      if (p.includes("queue")) return Promise.resolve(makeQueue("email_sent"));
      return Promise.resolve(JSON.stringify(existingHospitals));
    });

    mockFs.writeFile.mockResolvedValue(undefined);

    const result = await service.approveNavigatorBatch(BATCH_ID, makeToken(BATCH_ID));

    // The draft has: name: "Test Cancer Centre", city: "Patna", state: "Bihar", contact.phone: "0612-000000".
    // This draft matches both existing-001 (by clean name+city+state) and existing-002 (by phone).
    // So it should be skipped as duplicate.
    expect(result.hospitalsAdded).toBe(0);
    expect(result.hospitalNames).toEqual([]);
    
    // Total hospitals should remain 2.
    const writeCalls = mockFs.writeFile.mock.calls;
    const hospitalsWrite = writeCalls.find((c) =>
      (c[0] as string).includes("hospitals")
    );
    const written = JSON.parse(hospitalsWrite![1] as string);
    expect(written.hospitals).toHaveLength(2);
    expect(written._meta.total_hospitals).toBe(2);
  });
});
