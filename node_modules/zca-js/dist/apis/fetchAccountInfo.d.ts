import type { User } from "../models/index.js";
export type FetchAccountInfoResponse = User;
export declare const fetchAccountInfoFactory: (ctx: import("../context.js").ContextBase, api: import("../apis.js").API) => () => Promise<User>;
