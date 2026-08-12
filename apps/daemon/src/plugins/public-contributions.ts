import type { ContributionRegistration, PublicContributionRegistration } from "@sovereign/protocol";

export function publicContribution(
  registration: ContributionRegistration,
): PublicContributionRegistration {
  if (registration.kind !== "agent") {
    return registration;
  }

  const { location, ...publicRegistration } = registration;
  void location;

  return publicRegistration;
}

export function publicContributions(
  registrations: readonly ContributionRegistration[],
): PublicContributionRegistration[] {
  return registrations.map(publicContribution);
}
