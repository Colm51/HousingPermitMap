This is an experimental mapping of City of Toronto Open Data on building permits.

The source data is: https://open.toronto.ca/dataset/building-permits-active-permits/ and https://open.toronto.ca/dataset/building-permits-cleared-permits/

Locations were derived from: https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/

This data is complex, and significant validation is still required to address duplicate entries.

A major challenge is that entries for fields like PROPOSED_USE are not standardised. The same type of use may have many variant entries such as Residential Apartment vs Residential - Apartment Building. This makes categorisation based on type of property complex. This was not attempted in this map.

Instead, this mapping focuses on the units_created and units_lost field and categorises development based on the number of net new units. Note that condos and townhouse developments will appear as entries with a value of 1 net unit, but may be part of intensive developments and not single family home developments.



