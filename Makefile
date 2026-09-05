.PHONY: apply

# `make apply` runs a full provision. Extra words become --tags:
#   make apply web        -> tack run -sa -t web
#   make apply web print  -> tack run -sa -t web,print
comma := ,
empty :=
space := $(empty) $(empty)
TAGS := $(filter-out apply,$(MAKECMDGOALS))

apply:
	tack run -sa$(if $(strip $(TAGS)), -t $(subst $(space),$(comma),$(strip $(TAGS))))

# Absorb the tag words so make doesn't treat them as unknown targets.
ifneq ($(strip $(TAGS)),)
$(TAGS):
	@:
endif
