#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(OhaiScripture, NSObject)
RCT_EXTERN_METHOD(open:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(close:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
