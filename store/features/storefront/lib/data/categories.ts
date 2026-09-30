"use server"
import { gql } from "graphql-request"
import { openfrontClient } from "../config"
import { cache } from "react"

export const listCategories = cache(async function () {
  const LIST_CATEGORIES_QUERY = gql`
    query ListCategories {
      productCategories {
        id
        title
        handle
        isInternal
        isActive
      }
    }
  `;

  return openfrontClient.request(LIST_CATEGORIES_QUERY);
});

export const getCategoriesList = cache(async function (offset = 0, limit = 100) {
  const GET_CATEGORIES_LIST_QUERY = gql`
    query GetCategoriesList($offset: Int!, $limit: Int!) {
      productCategories(skip: $offset, take: $limit) {
        id
        title
        handle
        isInternal
        isActive
        parentCategory {
          id
          title
          handle
        }
        categoryChildren {
          id
          title
          handle
        }
      }
      productCategoriesCount
    }
  `;

  try {
    return await openfrontClient.request(GET_CATEGORIES_LIST_QUERY, { offset, limit });
  } catch (error) {
    // Fail soft (Task 23): same reasoning as `getCollectionsList` — the footer's
    // category group is optional, and a backend outage must not 500 every page
    // that renders the layout.
    console.error("Error fetching categories list:", error);
    return { productCategories: [], productCategoriesCount: 0 };
  }
});

export const getCategoryByHandle = cache(async function (categoryHandle: string) {
  const GET_CATEGORY_BY_HANDLE_QUERY = gql`
    query GetCategoryByHandle($handle: String!) {
      productCategory(where: { handle: $handle }) {
        id
        title
        handle
        description
        parentCategory {
          id
          title
          handle
        }
        categoryChildren {
          id
          title
          handle
        }
      }
    }
  `;

  return openfrontClient.request(GET_CATEGORY_BY_HANDLE_QUERY, {
    handle: categoryHandle,
  });
});
