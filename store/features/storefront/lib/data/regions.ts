"use server"
import { gql } from "graphql-request"
import { openfrontClient } from "../config"
import { cache } from "react"

export const listRegions = cache(async function () {
  const LIST_REGIONS_QUERY = gql`
    query ListRegions {
      regions {
        id
        name
        currency {
          code
        }
        countries {
          id
          name
          iso2
        }
      }
    }
  `;

  try {
    return await openfrontClient.request(LIST_REGIONS_QUERY);
  } catch (error) {
    // Fail soft (Task 23): SiteHeader renders on every storefront route, so an
    // unreachable backend must degrade the country switcher, never turn the
    // storefront's front door into a 500. A `null` region list is the
    // documented "regions unavailable" contract: SideMenu hides the switcher
    // and AccountProfilePage 404s rather than rendering data it cannot vouch
    // for. Mirrors the fail-soft returns in `store.ts` / `data.ts`.
    console.error("Error fetching regions list:", error);
    return { regions: null };
  }
});

export const getRegion = cache(async function (countryCode: string) {
  const GET_REGION_QUERY = gql`
    query GetRegion($code: String!) {
      regions(where: { countries: { some: { iso2: { equals: $code } } } }) {
        id
        name
        currency {
          code
        }
        countries {
          id
          name
          iso2
        }
      }
    }
  `;

  const data = await openfrontClient.request(GET_REGION_QUERY, {
    code: countryCode
  });
  return data.regions[0];
});
