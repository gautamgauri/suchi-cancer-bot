import { Controller, Get, Param, Query } from "@nestjs/common";
import { ActivityRegistryService } from "./activity-registry.service";

@Controller("activity-registry")
export class ActivityRegistryController {
  constructor(private readonly service: ActivityRegistryService) {}

  /** GET /v1/activity-registry/activities?programArea=sports&capabilityId=C3 */
  @Get("activities")
  async listActivities(
    @Query("programArea") programArea?: string,
    @Query("capabilityId") capabilityId?: string,
    @Query("orgId") orgId?: string,
  ) {
    return this.service.listActivities({ programArea, capabilityId, orgId });
  }

  /** GET /v1/activity-registry/activities/:activityId */
  @Get("activities/:activityId")
  async getActivity(@Param("activityId") activityId: string) {
    return this.service.getActivity(activityId);
  }

  /** GET /v1/activity-registry/instances?center=Bihta&program=KHEL&limit=20 */
  @Get("instances")
  async listInstances(
    @Query("center") center?: string,
    @Query("program") program?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.listInstances({
      center,
      program,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** GET /v1/activity-registry/plans */
  @Get("plans")
  async getPlan(@Query("planId") planId?: string) {
    return this.service.getPlan(planId);
  }

  /** GET /v1/activity-registry/plans/:planId/months/:monthNumber */
  @Get("plans/:planId/months/:monthNumber")
  async getPlanMonth(
    @Param("planId") planId: string,
    @Param("monthNumber") monthNumber: string,
  ) {
    return this.service.getPlanMonth(planId, parseInt(monthNumber, 10));
  }

  /** GET /v1/activity-registry/context — returns the activitiesContext string for proposal planner */
  @Get("context")
  async getContext(@Query("orgId") orgId?: string) {
    const context = await this.service.buildActivitiesContext(orgId);
    return { context };
  }
}
