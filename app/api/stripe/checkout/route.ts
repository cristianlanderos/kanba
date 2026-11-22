import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { adminDb as supabaseAdmin } from '@/lib/server/admin';
import { currentUser } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { price_id, success_url, cancel_url, mode } = await request.json();

    // Validate required parameters
    if (!price_id || !success_url || !cancel_url || !mode) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    if (!['payment', 'subscription'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "payment" or "subscription"' },
        { status: 400 }
      );
    }

    // The session cookie says who is paying.
    const user = await currentUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Failed to authenticate user' },
        { status: 401 }
      );
    }

    console.log(`🚀 Creating checkout session for user: ${user.id}`);

    // Check if customer exists in our database
    const { data: customer, error: getCustomerError } = await supabaseAdmin
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer information:', getCustomerError);
      return NextResponse.json(
        { error: 'Failed to fetch customer information' },
        { status: 500 }
      );
    }

    let customerId: string;

    if (!customer || !customer.customer_id) {
      // Create new Stripe customer
      console.log(`👤 Creating new Stripe customer for user: ${user.id}`);
      
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });

      console.log(`✅ Created Stripe customer: ${newCustomer.id}`);

      // Save customer mapping in database
      const { error: createCustomerError } = await supabaseAdmin
        .from('stripe_customers')
        .insert({
          user_id: user.id,
          customer_id: newCustomer.id,
        });

      if (createCustomerError) {
        console.error('Failed to save customer mapping:', createCustomerError);
        
        // Clean up Stripe customer if database insert fails
        try {
          await stripe.customers.del(newCustomer.id);
        } catch (deleteError) {
          console.error('Failed to clean up Stripe customer:', deleteError);
        }

        return NextResponse.json(
          { error: 'Failed to create customer mapping' },
          { status: 500 }
        );
      }

      // Create subscription record if needed
      if (mode === 'subscription') {
        const { error: createSubscriptionError } = await supabaseAdmin
          .from('stripe_subscriptions')
          .insert({
            customer_id: newCustomer.id,
            status: 'not_started',
          });

        if (createSubscriptionError) {
          console.error('Failed to create subscription record:', createSubscriptionError);
          return NextResponse.json(
            { error: 'Failed to create subscription record' },
            { status: 500 }
          );
        }
      }

      customerId = newCustomer.id;
    } else {
      customerId = customer.customer_id;
      console.log(`👤 Using existing Stripe customer: ${customerId}`);

      // Ensure subscription record exists for existing customer
      if (mode === 'subscription') {
        const { data: subscription, error: getSubscriptionError } = await supabaseAdmin
          .from('stripe_subscriptions')
          .select('status')
          .eq('customer_id', customerId)
          .maybeSingle();

        if (getSubscriptionError) {
          console.error('Failed to fetch subscription:', getSubscriptionError);
          return NextResponse.json(
            { error: 'Failed to fetch subscription information' },
            { status: 500 }
          );
        }

        if (!subscription) {
          const { error: createSubscriptionError } = await supabaseAdmin
            .from('stripe_subscriptions')
            .insert({
              customer_id: customerId,
              status: 'not_started',
            });

          if (createSubscriptionError) {
            console.error('Failed to create subscription record:', createSubscriptionError);
            return NextResponse.json(
              { error: 'Failed to create subscription record' },
              { status: 500 }
            );
          }
        }
      }
    }

    // Create Stripe checkout session
    console.log(`💳 Creating checkout session for customer: ${customerId}`);
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [
        {
          price: price_id,
          quantity: 1,
        },
      ],
      mode: mode as 'payment' | 'subscription',
      success_url,
      cancel_url,
      metadata: {
        userId: user.id,
      },
    });

    console.log(`✅ Created checkout session: ${session.id}`);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });

  } catch (error: any) {
    console.error('💥 Checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}