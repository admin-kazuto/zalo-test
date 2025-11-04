import type { Gender, ZBusinessPackage } from "../models/index.js";
export type FriendRecommendationsCollapseMsgListConfig = {
    collapseId: number;
    collapseXItem: number;
    collapseYItem: number;
};
export type FriendRecommendationsDataInfo = {
    userId: string;
    zaloName: string;
    displayName: string;
    avatar: string;
    phoneNumber: string;
    status: string;
    gender: Gender;
    dob: number;
    type: number;
    recommType: number;
    recommSrc: number;
    recommTime: number;
    recommInfo: {
        suggestWay: number;
        source: number;
        message: string;
        customText: string | null;
    };
    bizPkg: ZBusinessPackage;
    isSeenFriendReq: boolean;
};
export type FriendRecommendationsRecommItem = {
    recommItemType: number;
    dataInfo: FriendRecommendationsDataInfo;
};
export type GetFriendRecommendationsResponse = {
    expiredDuration: number;
    collapseMsgListConfig: FriendRecommendationsCollapseMsgListConfig;
    recommItems: FriendRecommendationsRecommItem[];
};
export declare const getFriendRecommendationsFactory: (ctx: import("../context.js").ContextBase, api: import("../apis.js").API) => () => Promise<GetFriendRecommendationsResponse>;
