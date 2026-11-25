/**
 * SocialPostService is now the content pipeline's door into the social
 * module's clinical lane. The old GET approve and reject links are retired.
 */
import { SocialPostService, articlePath } from "./social-post.service";
import { AdminController } from "./admin.controller";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";

describe("SocialPostService", () => {
  it("sends an approved article to the clinical lane with its site path", async () => {
    const social = { queueFromArticle: jest.fn(async () => ({ status: "waiting_for_review", reason: "ai_draft" })) };
    const svc = new SocialPostService(social as never);
    const r = await svc.generateAndQueue("chemotherapy", "Chemotherapy", "treatment");
    expect(social.queueFromArticle).toHaveBeenCalledWith("chemotherapy", "/tests-treatment/treatments/chemotherapy/");
    expect(r.status).toBe("waiting_for_review");
  });

  it("maps content types to site sections", () => {
    expect(articlePath("oral-cancer", "cancer_type")).toBe("/cancer-types/oral-cancer/");
    expect(articlePath("x", "unknown")).toBe("/resources/x/");
  });
});

describe("retired one-click social links", () => {
  const proto = AdminController.prototype as unknown as Record<string, unknown>;

  it("answer both old GET routes with a page that changes nothing", () => {
    expect(Reflect.getMetadata(METHOD_METADATA, proto.retiredSocialLink)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.retiredSocialLink)).toEqual(["social/approve/:id", "social/reject/:id"]);
    const res = { code: 0, body: "", status(c: number) { this.code = c; return this; }, send(b: string) { this.body = b; return this; } };
    const ctrl = Object.create(AdminController.prototype) as AdminController;
    ctrl.retiredSocialLink(res as never);
    expect(res.code).toBe(410);
    expect(res.body).toContain("nothing was posted");
  });

  it("no longer exposes approvePost or rejectPost", () => {
    const svc = SocialPostService.prototype as unknown as Record<string, unknown>;
    expect(svc.approvePost).toBeUndefined();
    expect(svc.rejectPost).toBeUndefined();
  });
});
