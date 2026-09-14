import { oc } from "@orpc/contract";
import { cloudContract } from "./cloud.contract";
import { meContract } from "./me.contract";
import { recordingContract } from "./recording.contract";

export const contract = oc.router({
  me: meContract,
  recording: recordingContract,
  cloud: cloudContract,
});

export { cloudContract, meContract, recordingContract };

export type Contract = typeof contract;
