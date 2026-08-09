// @vitest-environment jsdom

import type { PlaceContext as ProtocolPlaceContext } from "@sovereign/protocol";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import * as browserSdk from "./index.tsx";
import { Place, PlaceCollection, type PlaceContext } from "./index.tsx";

afterEach(cleanup);

it("exports only the public place components at runtime", () => {
  expect(Object.keys(browserSdk).sort()).toEqual(["Place", "PlaceCollection"]);
});

it("keeps its public place context structurally compatible with the protocol", () => {
  const sdkContext: PlaceContext = { project: "work", subject: { sessionId: "s1" } };
  const protocolContext: ProtocolPlaceContext = sdkContext;
  const roundTrip: PlaceContext = protocolContext;

  expect(roundTrip).toEqual(sdkContext);
});

it("renders an empty result when Place has no browser runtime", () => {
  const view = render(<Place id="placed.board" context={{}} />);

  expect(view.container.firstChild).toBeNull();
});

it("renders an empty result when PlaceCollection has no browser runtime", () => {
  const view = render(<PlaceCollection id="placed.actions" context={{}} />);

  expect(view.container.firstChild).toBeNull();
});
