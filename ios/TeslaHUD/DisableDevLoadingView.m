#if DEBUG
#import <React/RCTBridgeModule.h>
#import <React/RCTDevLoadingViewProtocol.h>
#import <objc/runtime.h>

@interface DisableDevLoadingView : NSObject <RCTDevLoadingViewProtocol>
@end

@implementation DisableDevLoadingView

+ (void)load {
  // No-op: prevents the blue "Refreshing..." bar from appearing
}

- (void)showMessage:(NSString *)message color:(UIColor *)color backgroundColor:(UIColor *)backgroundColor {}
- (void)showWithURL:(NSURL *)URL {}
- (void)hide {}

+ (NSString *)moduleName { return @"DevLoadingView"; }
+ (BOOL)requiresMainQueueSetup { return NO; }

@end
#endif
